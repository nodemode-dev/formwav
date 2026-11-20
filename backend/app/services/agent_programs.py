"""The agent programs formwav can run in a terminal tab: Claude Code, Codex, Cursor's agent and Antigravity (Google's agy).

status() answers in one call which of them are on this computer, each with its version, whether it is signed in when
that can be told without a model call, and the line that installs it. Codex, Cursor and Antigravity tabs get a token of
their own in the child's environment (FORMWAV_INAPP_TOKEN, with FORMWAV_MCP_URL beside it), never on a command line, and
the token ends when the tab is closed. configure() leaves a small file in the agent folder that names formwav's MCP
server through those two variables, so the file itself holds no secret. Antigravity reads its servers from a file that
cannot name a variable, so write_tab_entry() puts the tab's own entry there and remove_tab_entry() takes it out at close.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from . import agent_lookup, claude_code

TOKEN_VAR = "FORMWAV_INAPP_TOKEN"
URL_VAR = "FORMWAV_MCP_URL"
MARK = "# written by formwav for its Codex tab; formwav rewrites this file each time the tab opens"
CLAUDE_INSTALL = agent_lookup.install("claude")
PROGRAMS = {
    "codex": {"bin": "codex", "title": "Codex", "install": "npm install -g @openai/codex"},
    "cursor": {"bin": "cursor-agent", "title": "Cursor", "install": "curl https://cursor.com/install -fsS | bash"},
    "antigravity": {"bin": "agy", "title": "Antigravity", "install": agent_lookup.install("antigravity")},
}
TAB_ENTRY = claude_code.TAB_ENTRY
TAB_HEADER = "x-formwav-inapp"
_status: dict = {"at": 0.0, "value": None}


def find(kind: str) -> str | None:
    return claude_code.located(kind).path


def said(found: agent_lookup.Found) -> str:
    return agent_lookup.sentence(found, PROGRAMS[found.program]["install"], claude_code.OTHERWISE)


def missing(kind: str) -> str:
    return said(claude_code.located(kind))


def _claude_signed_in(path: str) -> bool | None:
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return True
    try:
        out = agent_lookup.run([path, "auth", "status"], claude_code.child_env(path), claude_code.CHECK_WAIT)
        data = json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return bool(data["loggedIn"]) if isinstance(data, dict) and "loggedIn" in data else None


def status(fresh: bool = False) -> dict:
    if not fresh and _status["value"] is not None and time.monotonic() - _status["at"] < 60:
        return _status["value"]
    claude = claude_code.located("claude", fresh)
    out = {"claude": agent_lookup.answer(claude, CLAUDE_INSTALL, claude_code.OTHERWISE) | {"signedIn": _claude_signed_in(claude.path) if claude.state == "runs" else None, "install": CLAUDE_INSTALL, "title": "Claude Code"}}
    for kind, program in PROGRAMS.items():
        found = claude_code.located(kind, fresh)
        out[kind] = agent_lookup.answer(found, program["install"], claude_code.OTHERWISE) | {"signedIn": None, "install": program["install"], "title": program["title"]}
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


def _tab_file(folder: Path) -> Path:
    return folder / ".agents" / "mcp_config.json"


def _servers(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8") or "{}") if path.exists() else {}
    if not isinstance(data, dict) or not isinstance(data.get("mcpServers", {}), dict):
        raise OSError(f"{path} is not an MCP servers file formwav can read, so it was left alone")
    return data


def _replace(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + f".part-{os.getpid()}")
    with os.fdopen(os.open(part, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as out:
        out.write(json.dumps(data, indent=2) + "\n")
    os.replace(part, path)


def write_tab_entry(folder: Path, base: str, token: str) -> None:
    """An Antigravity tab's own entry, formwav_tab, in the agent folder's .agents/mcp_config.json: the engine's address
    and the tab's token. Every other entry and key in the file is kept; the file is replaced whole and is the user's alone."""
    path = _tab_file(folder)
    data = _servers(path)
    data.setdefault("mcpServers", {})[TAB_ENTRY] = {"serverUrl": f"{base}/mcp", "headers": {TAB_HEADER: token}}
    _replace(path, data)


def remove_tab_entry(folder: Path, token: str) -> None:
    """Takes the tab's entry out when the tab closes, only while it still carries this tab's token; nothing else is touched."""
    path = _tab_file(folder)
    try:
        data = _servers(path)
        entry = data.get("mcpServers", {}).get(TAB_ENTRY)
        if not isinstance(entry, dict) or (entry.get("headers") or {}).get(TAB_HEADER) != token:
            return
        del data["mcpServers"][TAB_ENTRY]
        _replace(path, data)
    except (OSError, ValueError):
        return
