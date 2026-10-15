"""Claude Code inside formwav: the user's own `claude` program, run with their own login, given formwav's tools.

Two ways in, both the same program: the Agent column's chat runs `claude -p ... --output-format stream-json` once per
message and streams what it says and does; the terminal's Claude Code button runs `claude` interactively in a PTY.
Both get formwav's MCP server inline (`--mcp-config`), the engine's own /mcp over HTTP, carrying a token made fresh
for each engine so the window can tell its own Claude from an outside agent.
"""

from __future__ import annotations

import json
import os
import secrets
import shlex
import shutil
import subprocess
import time
from pathlib import Path

INAPP_TOKEN = secrets.token_urlsafe(24)
KEEP = {"CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CONFIG_DIR"}
DROP = {"ANTHROPIC_API_KEY", "FORMWAV_PORT", "FORMWAV_EXIT_WITH_STDIN", "FORMWAV_DATA_DIR", "FORMWAV_DIST"}
INSTALL = "Claude Code is not installed: install it from https://claude.com/claude-code, run claude once in a terminal to sign in, then try again."
NOTE = (
    "You are working inside formwav, an audio editor, on the session the user has open. Its tools (mcp__formwav__*) act "
    "on that session: call get_session first for the track and clip ids; times are seconds and levels dB. Measure with "
    "analyze_clip before changing levels or repairing. Make the smallest set of changes that does what was asked; every "
    "change is one undo step in formwav's History. Finish with one or two sentences on what you changed."
)

_info: dict = {"at": 0.0, "value": None}


def _candidates() -> list[str]:
    home = Path.home()
    dirs = [home / ".claude" / "local", home / ".local" / "bin", home / ".npm-global" / "bin", home / ".bun" / "bin", home / ".volta" / "bin", Path("/opt/homebrew/bin"), Path("/usr/local/bin"), Path("/usr/bin")]
    if os.name == "nt":
        appdata = Path(os.environ.get("APPDATA", str(home)))
        dirs = [appdata / "npm", home / ".local" / "bin", home / "AppData" / "Local" / "Programs" / "claude"]
        return [str(d / name) for d in dirs for name in ("claude.cmd", "claude.exe", "claude")]
    return [str(d / "claude") for d in dirs]


def cli() -> str | None:
    """The `claude` program: FORMWAV_CLAUDE_BIN, the PATH, the usual install folders, then the login shell's PATH (an
    app started from the dock or Finder gets a short PATH that misses npm's and the installer's folders)."""
    named = os.environ.get("FORMWAV_CLAUDE_BIN")
    if named and Path(named).exists():
        return named
    found = shutil.which("claude")
    if found:
        return found
    for path in _candidates():
        if Path(path).is_file() and os.access(path, os.X_OK):
            return path
    if os.name != "nt":
        shell = os.environ.get("SHELL") or "/bin/bash"
        try:
            out = subprocess.run([shell, "-l", "-c", "command -v claude"], capture_output=True, text=True, timeout=8)
            line = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
            if line and Path(line).exists():
                return line
        except (OSError, subprocess.SubprocessError):
            pass
    return None


def info() -> dict:
    """Whether Claude Code is installed, where and which version; kept for a minute."""
    if _info["value"] is not None and time.monotonic() - _info["at"] < 60:
        return _info["value"]
    path = cli()
    version = None
    if path:
        try:
            out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=15, env=child_env())
            version = (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr).strip() else None
        except (OSError, subprocess.SubprocessError):
            version = None
    value = {"installed": bool(path), "path": path, "version": version, "workdir": str(workdir()), "message": None if path else INSTALL}
    _info.update(at=time.monotonic(), value=value)
    return value


def child_env() -> dict[str, str]:
    """The environment Claude Code and the terminal's shell start with: the engine's, less what would change who
    pays or where things go (an API key from formwav's .env would bill per token instead of the user's plan; a nested
    Claude Code session's variables; the engine's own settings), and with the library path a frozen engine changed put
    back as it was."""
    env = {k: v for k, v in os.environ.items() if k not in DROP and (not k.startswith("CLAUDE") or k in KEEP)}
    for name in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        original = os.environ.get(f"{name}_ORIG")
        if original is not None:
            env[name] = original
        elif os.environ.get("_MEIPASS2") or getattr(__import__("sys"), "frozen", False):
            env.pop(name, None)
    env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "FORMWAV_TERMINAL": "1"})
    return env


def workdir() -> Path:
    """Where Claude Code runs: FORMWAV_AGENT_DIR, else ~/formwav/Agent, made if missing."""
    path = Path(os.environ.get("FORMWAV_AGENT_DIR") or (Path.home() / "formwav" / "Agent"))
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return Path.home()
    return path


def mcp_config(base: str) -> str:
    return json.dumps({"mcpServers": {"formwav": {"type": "http", "url": f"{base}/mcp", "headers": {"x-formwav-inapp": INAPP_TOKEN}}}})


def argv(base: str, prompt: str | None = None, resume: str | None = None, print_mode: bool = False) -> list[str]:
    """The `claude` command line: formwav's tools inline and allowed, the note on working in formwav, a resumed session
    when there is one, and for the chat the streaming print mode."""
    path = cli()
    if not path:
        raise FileNotFoundError(INSTALL)
    args = [path]
    if print_mode:
        args += ["-p", prompt or "", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    args += ["--mcp-config", mcp_config(base), "--allowedTools", "mcp__formwav", "--append-system-prompt", NOTE]
    if resume:
        args += ["--resume", resume]
    if prompt and not print_mode:
        args.append(prompt)
    return args


def shell_wrapped(args: list[str]) -> list[str]:
    """On macOS and Linux through a login shell, so the user's PATH (node, npm) applies; on Windows as it is."""
    if os.name == "nt":
        return args
    shell = os.environ.get("SHELL") or "/bin/bash"
    return [shell, "-l", "-c", "exec " + " ".join(shlex.quote(a) for a in args)]
