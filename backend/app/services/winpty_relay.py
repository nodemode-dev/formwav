"""The embedded terminal on Windows: the shell or Claude Code in a ConPTY through pywinpty (MIT), relayed over the same
WebSocket protocol as the POSIX path in routers/terminal.py."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
import time

from fastapi import WebSocket


def shell() -> list[str]:
    for name in ("pwsh", "powershell"):
        found = shutil.which(name)
        if found:
            return [found, "-NoLogo"]
    return [os.environ.get("COMSPEC", "cmd.exe")]


def runnable(argv: list[str]) -> list[str]:
    if argv and argv[0].lower().endswith((".cmd", ".bat")):
        return [os.environ.get("COMSPEC", "cmd.exe"), "/c", *argv]
    return argv


async def relay(ws: WebSocket, argv: list[str], cwd: str, env: dict[str, str]) -> None:
    try:
        from winpty import PtyProcess
    except ImportError:
        await ws.send_bytes(b"\r\nThe terminal on Windows needs pywinpty: pip install -r backend/requirements.txt\r\n")
        await ws.close()
        return
    try:
        proc = PtyProcess.spawn(runnable(argv), cwd=cwd, env=env, dimensions=(24, 80))
    except Exception as err:
        await ws.send_bytes(f"\r\nCould not start {argv[0]}: {err}\r\n".encode())
        await ws.close()
        return
    loop = asyncio.get_running_loop()
    out: asyncio.Queue[bytes] = asyncio.Queue()

    def pump() -> None:
        while True:
            try:
                data = proc.read(65536)
            except EOFError:
                break
            except Exception:
                break
            if data:
                loop.call_soon_threadsafe(out.put_nowait, data.encode("utf-8", "replace"))
            elif not proc.isalive():
                break
            else:
                time.sleep(0.02)
        loop.call_soon_threadsafe(out.put_nowait, b"")

    threading.Thread(target=pump, daemon=True).start()

    async def to_browser() -> None:
        while (data := await out.get()):
            await ws.send_bytes(data)

    async def to_shell() -> None:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                return
            if msg.get("bytes") is not None:
                proc.write(msg["bytes"].decode("utf-8", "replace"))
            elif msg.get("text"):
                ctl = json.loads(msg["text"])
                if ctl.get("type") == "resize":
                    proc.setwinsize(max(1, int(ctl.get("rows", 24))), max(1, int(ctl.get("cols", 80))))
                elif ctl.get("type") == "input":
                    proc.write(str(ctl.get("data", "")))

    tasks = [asyncio.create_task(to_browser()), asyncio.create_task(to_shell())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        try:
            proc.terminate(force=True)
        except Exception:
            pass
        try:
            await ws.close()
        except RuntimeError:
            pass
