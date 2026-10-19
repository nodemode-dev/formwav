"""Terminal sessions the engine owns: a shell or Claude Code in a pseudo-terminal that outlives the page.

Each session keeps a bounded scrollback of its output and a set of subscriber queues (one per attached WebSocket), so
a reloaded page or a reopened dock attaches to the same running program and sees its recent output. Everything here
runs on the engine's event loop; the Windows reader thread hands its output over with call_soon_threadsafe.
"""

from __future__ import annotations

import asyncio
import codecs
import os
import signal
import struct
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from . import claude_code

SCROLLBACK = 256 * 1024
MAX_SESSIONS = 16
SESSIONS: dict[str, "Session"] = {}
_tasks: set[asyncio.Task] = set()


class Unavailable(Exception):
    pass


def supported() -> bool:
    return os.name in ("posix", "nt")


def shell_argv() -> list[str]:
    if os.name == "nt":
        from . import winpty_relay

        return winpty_relay.shell()
    return [os.environ.get("SHELL") or "/bin/bash", "-l"]


class _Posix:
    def __init__(self, session: "Session", loop: asyncio.AbstractEventLoop) -> None:
        import fcntl
        import pty
        import termios

        self.session, self.loop, self.done = session, loop, False
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        size = struct.pack("HHHH", session.rows, session.cols, 0, 0)
        pid, fd = pty.fork()
        if pid == 0:
            try:
                fcntl.ioctl(0, termios.TIOCSWINSZ, size)
                os.chdir(session.cwd)
            except OSError:
                pass
            try:
                os.execvpe(session.argv[0], session.argv, session.env)
            finally:
                os._exit(127)
        self.pid, self.fd = pid, fd
        loop.add_reader(fd, self.readable)

    def readable(self) -> None:
        try:
            data = os.read(self.fd, 65536)
        except OSError:
            data = b""
        if data:
            text = self.decoder.decode(data)
            if text:
                self.session.emit(self, text)
            return
        self.session.ended(self)

    def write(self, data: str) -> None:
        raw = data.encode("utf-8", "replace")
        try:
            while raw:
                raw = raw[os.write(self.fd, raw):]
        except OSError:
            pass

    def resize(self, cols: int, rows: int) -> None:
        import fcntl
        import termios

        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

    def stop(self) -> None:
        if self.done:
            return
        self.done = True
        try:
            self.loop.remove_reader(self.fd)
        except (ValueError, OSError):
            pass
        try:
            os.kill(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        task = self.loop.create_task(self.reap())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)

    async def reap(self) -> None:
        for _ in range(20):
            try:
                gone, _status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                break
            if gone:
                break
            await asyncio.sleep(0.05)
        else:
            try:
                os.kill(self.pid, signal.SIGKILL)
                os.waitpid(self.pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        try:
            os.close(self.fd)
        except OSError:
            pass


class _Windows:
    def __init__(self, session: "Session", loop: asyncio.AbstractEventLoop) -> None:
        try:
            from winpty import PtyProcess
        except ImportError:
            raise Unavailable("The terminal on Windows needs pywinpty: pip install -r backend/requirements.txt") from None
        from . import winpty_relay

        self.session, self.loop, self.done = session, loop, False
        try:
            self.proc = PtyProcess.spawn(winpty_relay.runnable(session.argv), cwd=session.cwd, env=session.env, dimensions=(session.rows, session.cols))
        except Exception as err:
            raise Unavailable(f"Could not start {session.argv[0]}: {err}") from None
        threading.Thread(target=self.pump, name=f"pty-{session.id}", daemon=True).start()

    def pump(self) -> None:
        while not self.done:
            try:
                data = self.proc.read(65536)
            except Exception:
                break
            if data:
                self.loop.call_soon_threadsafe(self.session.emit, self, data)
            elif not self.proc.isalive():
                break
            else:
                time.sleep(0.02)
        if not self.done:
            self.loop.call_soon_threadsafe(self.session.ended, self)

    def write(self, data: str) -> None:
        try:
            self.proc.write(data)
        except Exception:
            pass

    def resize(self, cols: int, rows: int) -> None:
        try:
            self.proc.setwinsize(rows, cols)
        except Exception:
            pass

    def stop(self) -> None:
        self.done = True
        try:
            self.proc.terminate(force=True)
        except Exception:
            pass


class Session:
    def __init__(self, sid: str, title: str, kind: str, argv: list[str], cwd: str, env: dict[str, str], cols: int, rows: int) -> None:
        self.id, self.title, self.kind = sid, title, kind
        self.argv, self.cwd, self.env = argv, cwd, env
        self.cols, self.rows = cols, rows
        self.alive = False
        self.proc: _Posix | _Windows | None = None
        self.chunks: deque[str] = deque()
        self.size = 0
        self.subscribers: set[asyncio.Queue] = set()

    def describe(self) -> dict:
        return {"id": self.id, "title": self.title, "kind": self.kind, "alive": self.alive}

    def start(self) -> None:
        loop = asyncio.get_running_loop()
        self.proc = _Posix(self, loop) if os.name == "posix" else _Windows(self, loop)
        self.alive = True

    def deliver(self, item: str | None) -> None:
        for queue in list(self.subscribers):
            if queue.qsize() < 4000:
                queue.put_nowait(item)

    def emit(self, proc: object, text: str) -> None:
        if proc is not self.proc:
            return
        self.chunks.append(text)
        self.size += len(text)
        while self.size > SCROLLBACK and len(self.chunks) > 1:
            self.size -= len(self.chunks.popleft())
        self.deliver(text)

    def ended(self, proc: object) -> None:
        if proc is not self.proc:
            return
        self.alive = False
        proc.stop()
        self.deliver(None)

    def attach(self) -> tuple[str, asyncio.Queue]:
        queue: asyncio.Queue = asyncio.Queue()
        self.subscribers.add(queue)
        return "".join(self.chunks), queue

    def write(self, data: str) -> None:
        if self.alive and self.proc is not None:
            self.proc.write(data)

    def resize(self, cols: int, rows: int) -> None:
        self.cols, self.rows = max(10, min(cols, 1000)), max(4, min(rows, 500))
        if self.alive and self.proc is not None:
            self.proc.resize(self.cols, self.rows)

    def restart(self) -> None:
        old = self.proc
        self.proc = None
        if old is not None:
            old.stop()
        self.chunks.clear()
        self.size = 0
        self.deliver("\x1bc")
        self.start()

    def close(self) -> None:
        old, self.proc, self.alive = self.proc, None, False
        if old is not None:
            old.stop()
        self.deliver(None)


def _open(title: str, kind: str, argv: list[str], cwd: str, cols: int, rows: int) -> Session:
    if not supported():
        raise Unavailable("The terminal is not available on this system")
    if len(SESSIONS) >= MAX_SESSIONS:
        raise Unavailable(f"At most {MAX_SESSIONS} terminals can be open; close one first")
    session = Session(uuid.uuid4().hex[:12], title, kind, argv, cwd, claude_code.child_env(), max(10, min(cols, 1000)), max(4, min(rows, 500)))
    session.start()
    SESSIONS[session.id] = session
    return session


def open_shell(cols: int, rows: int) -> Session:
    n = sum(1 for s in SESSIONS.values() if s.kind == "shell") + 1
    return _open(f"Terminal {n}", "shell", shell_argv(), str(Path.home()), cols, rows)


def open_claude(base: str, prompt: str | None, resume: str | None, cols: int, rows: int) -> Session:
    argv = claude_code.argv(base, prompt=prompt or None, resume=resume or None)
    if os.name != "nt":
        argv = claude_code.shell_wrapped(argv)
    return _open("Claude Code", "claude", argv, str(claude_code.workdir()), cols, rows)


def get(sid: str) -> Session:
    session = SESSIONS.get(sid)
    if session is None:
        raise KeyError(sid)
    return session


def close(sid: str) -> None:
    get(sid)
    SESSIONS.pop(sid).close()
