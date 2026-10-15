"""The embedded terminal (owner decision, Sprint D): a real shell in a pseudo-terminal, relayed over a WebSocket.

The shell is the user's own ($SHELL, else bash) started as a login shell in their home directory with TERM set for
xterm.js; bytes from the browser go to the PTY untouched and the PTY's output comes back as binary frames; a JSON text
frame {"type": "resize", "cols", "rows"} sets the window size the shell sees. When the shell exits the socket closes,
and when the socket closes the shell is hung up.

Browsers let any page open a WebSocket to 127.0.0.1, so the socket is only accepted from the app's own origins (the
same list as CORS, FORMWAV_CORS_ORIGINS); a page from anywhere else is refused before a shell is started.
FORMWAV_TERMINAL=0 turns the terminal off. On Windows the same protocol runs over ConPTY (services/winpty_relay.py).
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import struct

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.config import cors_origins

router = APIRouter()


def _allowed(origin: str | None, host: str | None) -> bool:
    from ..core.security import ws_allowed

    return ws_allowed(origin, host)


@router.websocket("/terminal")
async def terminal(ws: WebSocket) -> None:
    if os.environ.get("FORMWAV_TERMINAL", "1") == "0" or os.name not in ("posix", "nt") or not _allowed(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=4403)  # before accept: the handshake is refused (HTTP 403)
        return
    if os.name == "nt":
        from ..services import claude_code, winpty_relay

        await ws.accept()
        argv, cwd = winpty_relay.shell(), os.path.expanduser("~")
        if ws.query_params.get("run") == "claude":
            try:
                argv = claude_code.argv(f"http://{ws.headers.get('host')}", resume=ws.query_params.get("resume") or None)
                cwd = str(claude_code.workdir())
            except FileNotFoundError as err:
                await ws.send_bytes(f"\r\n{err}\r\n".encode())
                await ws.close()
                return
        await winpty_relay.relay(ws, argv, cwd, claude_code.child_env())
        return
    import fcntl
    import pty
    import termios

    from ..services import claude_code

    await ws.accept()
    shell = os.environ.get("SHELL") or "/bin/bash"
    run_claude = ws.query_params.get("run") == "claude"
    argv = [shell, "-l"]
    cwd = os.path.expanduser("~")
    if run_claude:
        try:
            argv = claude_code.shell_wrapped(claude_code.argv(f"http://{ws.headers.get('host')}", resume=ws.query_params.get("resume") or None))
            cwd = str(claude_code.workdir())
        except FileNotFoundError as err:
            await ws.send_bytes(f"\r\n{err}\r\n".encode())
            await ws.close()
            return
    env = claude_code.child_env()
    pid, fd = pty.fork()
    if pid == 0:  # the child becomes the shell, or Claude Code through a login shell
        try:
            os.chdir(cwd)
        except OSError:
            pass
        os.execvpe(argv[0], argv, env)
    loop = asyncio.get_running_loop()
    out: asyncio.Queue[bytes] = asyncio.Queue()

    def readable() -> None:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b""
        if not data:
            loop.remove_reader(fd)
        out.put_nowait(data)

    loop.add_reader(fd, readable)

    async def to_browser() -> None:
        while (data := await out.get()):
            await ws.send_bytes(data)

    async def to_shell() -> None:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                return
            if msg.get("bytes") is not None:
                os.write(fd, msg["bytes"])
            elif msg.get("text"):
                ctl = json.loads(msg["text"])
                if ctl.get("type") == "resize":
                    rows, cols = max(1, int(ctl.get("rows", 24))), max(1, int(ctl.get("cols", 80)))
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                elif ctl.get("type") == "input":
                    os.write(fd, str(ctl.get("data", "")).encode())

    tasks = [asyncio.create_task(to_browser()), asyncio.create_task(to_shell())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        try:
            loop.remove_reader(fd)
        except (ValueError, OSError):
            pass
        try:
            os.kill(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        # never a blocking wait on the event loop: a shell that ignores the hangup is killed after a second
        for _ in range(20):
            try:
                gone, _status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                break
            if gone:
                break
            await asyncio.sleep(0.05)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        os.close(fd)
        try:
            await ws.close()
        except RuntimeError:
            pass
