import ast
import asyncio
import inspect
import subprocess
import sys

from conftest import BACKEND

from app.core import no_window

THROUGH_POPEN = {
    ("subprocess", "Popen"),
    ("subprocess", "run"),
    ("subprocess", "call"),
    ("subprocess", "check_call"),
    ("subprocess", "check_output"),
    ("subprocess", "getoutput"),
    ("subprocess", "getstatusoutput"),
    ("asyncio", "create_subprocess_exec"),
    ("asyncio", "create_subprocess_shell"),
    ("os", "popen"),
}
OTHER_STARTS = {"system", "startfile", "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe", "posix_spawn", "posix_spawnp", "execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe", "CreateProcess", "CreateProcessW", "CreateProcessA", "ShellExecuteW", "ShellExecuteA", "spawn"}
NOT_STARTS = {("platform", "system")}
ALLOWED = {
    ("app/services/terminals.py", "os", "execvpe"): "POSIX only, in the child after pty.fork",
    ("app/routers/terminal.py", "os", "execvpe"): "POSIX only, in the child after pty.fork",
    ("app/services/terminals.py", "PtyProcess", "spawn"): "Windows ConPTY through pywinpty: a pseudoconsole, which has no window",
    ("app/services/winpty_relay.py", "PtyProcess", "spawn"): "Windows ConPTY through pywinpty: a pseudoconsole, which has no window",
}


def engine_files():
    yield BACKEND / "desktop_entry.py"
    for path in sorted((BACKEND / "app").rglob("*.py")):
        if "__pycache__" not in path.parts:
            yield path


def starts():
    found = []
    for path in engine_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imported = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module in ("subprocess", "asyncio", "os"):
                for alias in node.names:
                    imported[alias.asname or alias.name] = (node.module, alias.name)
        where = path.relative_to(BACKEND).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Attribute):
                owner = func.value.id if isinstance(func.value, ast.Name) else func.value.attr if isinstance(func.value, ast.Attribute) else ""
                found.append((where, node.lineno, owner, func.attr))
            elif isinstance(func, ast.Name) and func.id in imported:
                module, name = imported[func.id]
                found.append((where, node.lineno, module, name))
    return found


def test_every_program_the_engine_starts_goes_through_subprocess_popen_or_is_a_known_exception():
    found = starts()
    through = [item for item in found if (item[2], item[3]) in THROUGH_POPEN]
    other = [item for item in found if item[3] in OTHER_STARTS and (item[2], item[3]) not in THROUGH_POPEN | NOT_STARTS]
    unexplained = [item for item in other if (item[0], item[2], item[3]) not in ALLOWED]
    assert unexplained == []
    assert len(through) >= 100


def test_the_engine_entry_installs_the_flag_before_anything_else():
    tree = ast.parse((BACKEND / "desktop_entry.py").read_text(encoding="utf-8"))
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
    first, second = main.body[0], main.body[1]
    assert isinstance(first, ast.ImportFrom) and first.module == "app.core" and first.names[0].name == "no_window"
    call = second.value
    assert isinstance(call, ast.Call) and ast.unparse(call.func) == "no_window.install"


def test_the_flag_is_added_unless_the_caller_asked_for_a_console_of_its_own():
    assert no_window.flags(0) == 0x08000000
    assert no_window.flags(0x00000200) == 0x08000200
    assert no_window.flags(0x00000008 | 0x00000200) == 0x00000208
    assert no_window.flags(0x00000010) == 0x00000010


def test_off_windows_nothing_is_changed():
    before = subprocess.Popen.__init__
    assert no_window.install("linux") is False
    assert no_window.install("darwin") is False
    assert subprocess.Popen.__init__ is before


def test_on_windows_every_popen_carries_the_flag(monkeypatch):
    calls = []

    def record(self, *args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(subprocess.Popen, "__init__", record)
    assert no_window.install("win32") is True
    assert no_window.install("win32") is True
    subprocess.Popen(["ffmpeg", "-version"])
    subprocess.Popen(["ffmpeg"], creationflags=0x00000200)
    subprocess.Popen(["app"], creationflags=0x00000008)
    subprocess.Popen(["ffmpeg"], -1, None, None, None, None, None, True, False, None, None, None, None, 0x00000200)
    assert calls[0][1]["creationflags"] == 0x08000000
    assert calls[1][1]["creationflags"] == 0x08000200
    assert calls[2][1]["creationflags"] == 0x00000008
    assert calls[3][0][no_window.FLAGS_AT] == 0x08000200
    assert len(calls) == 4


def test_the_positional_place_of_creationflags_is_popens_own():
    names = list(inspect.signature(subprocess.Popen.__init__).parameters)[1:]
    assert names.index("creationflags") == no_window.FLAGS_AT


def test_asyncio_starts_a_program_through_subprocess_popen(monkeypatch):
    original = subprocess.Popen.__init__
    seen = []

    def counted(self, *args, **kwargs):
        seen.append(args[0] if args else kwargs.get("args"))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(subprocess.Popen, "__init__", counted)

    async def run():
        proc = await asyncio.create_subprocess_exec(sys.executable, "-c", "pass")
        return await proc.wait()

    assert asyncio.run(run()) == 0
    assert seen and seen[0][0] == sys.executable
