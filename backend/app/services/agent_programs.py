"""The agent programs formwav can run in a terminal tab: Claude Code, Codex and Cursor's agent.

status() answers in one call which of them are on this computer, each with its version, whether it is signed in when
that can be told without a model call, and the line that installs it. Codex and Cursor tabs get a token of their own
in the child's environment (FORMWAV_INAPP_TOKEN, with FORMWAV_MCP_URL beside it), never on a command line, and the
token ends when the tab is closed. configure() leaves a small file in the agent folder that names formwav's MCP server
through those two variables, so the file itself holds no secret.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import claude_code

TOKEN_VAR = "FORMWAV_INAPP_TOKEN"
URL_VAR = "FORMWAV_MCP_URL"
MARK = "# written by formwav for its Codex tab; formwav rewrites this file each time the tab opens"
CLAUDE_INSTALL = "irm https://claude.ai/install.ps1 | iex" if sys.platform == "win32" else "curl -fsSL https://claude.ai/install.sh | bash"
PROGRAMS = {
    "codex": {"bin": "codex", "title": "Codex", "install": "npm install -g @openai/codex"},
    "cursor": {"bin": "cursor-agent", "title": "Cursor", "install": "curl https://cursor.com/install -fsS | bash"},
}
_status: dict = {"at": 0.0, "value": None}


def find(kind: str) -> str | None:
    binary = PROGRAMS[kind]["bin"]
    found = shutil.which(binary, path=claude_code.child_env().get("PATH"))
    if found or os.name == "nt":
        return found
    shell = os.environ.get("SHELL") or "/bin/bash"
    try:
        out = subprocess.run([shell, "-l", "-c", f"command -v {binary}"], capture_output=True, text=True, timeout=8, env=claude_code.child_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    lines = out.stdout.strip().splitlines()[-1:] if out.returncode == 0 else []
    return lines[0] if lines and os.path.isabs(lines[0]) and os.access(lines[0], os.X_OK) else None


def missing(kind: str) -> str:
    return f"{PROGRAMS[kind]['title']} is not installed on this computer. Install it with: {PROGRAMS[kind]['install']}"


def _version(path: str) -> str | None:
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=8, env=claude_code.child_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    said = (out.stdout or out.stderr).strip()
    return said.splitlines()[0][:80] if said else None


def _claude_signed_in(path: str) -> bool | None:
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return True
    try:
        out = subprocess.run([path, "auth", "status"], capture_output=True, text=True, timeout=8, env=claude_code.child_env(), stdin=subprocess.DEVNULL)
        data = json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return bool(data["loggedIn"]) if isinstance(data, dict) and "loggedIn" in data else None


def status(fresh: bool = False) -> dict:
    if not fresh and _status["value"] is not None and time.monotonic() - _status["at"] < 60:
        return _status["value"]
    claude = claude_code.info()
    path = claude["path"]
    out = {"claude": {"installed": bool(claude["installed"]), "path": path, "version": claude["version"], "signedIn": _claude_signed_in(path) if path else None, "install": CLAUDE_INSTALL, "title": "Claude Code"}}
    for kind, program in PROGRAMS.items():
        path = find(kind)
        out[kind] = {"installed": path is not None, "path": path, "version": _version(path) if path else None, "signedIn": None, "install": program["install"], "title": program["title"]}
    _status.update(at=time.monotonic(), value=out)
    return out


def _keep(path: Path, text: str, ours) -> bool:
    try:
        if path.exists() and not ours(path.read_text(encoding="utf-8")):
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(text)
        os.chmod(path, 0o600)
    except (OSError, ValueError):
        return False
    return True


def configure(kind: str, base: str, folder: Path) -> bool:
    if kind == "cursor":
        text = json.dumps({"mcpServers": {"formwav_tab": {"url": "${env:%s}" % URL_VAR, "headers": {"x-formwav-inapp": "${env:%s}" % TOKEN_VAR}}}}, indent=2) + "\n"
        return _keep(folder / ".cursor" / "mcp.json", text, lambda found: found == text)
    text = f'{MARK}\n[mcp_servers.formwav_tab]\nurl ={json.dumps(base + "/mcp")}\nenv_http_headers = {{ "x-formwav-inapp" = "{TOKEN_VAR}" }}\n'
    return _keep(folder / ".codex" / "config.toml", text, lambda found: found.startswith(MARK))
