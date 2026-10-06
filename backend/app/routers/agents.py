"""Connecting an agent to formwav's MCP server, for Settings > Agents (PLAN_v11 3.2, ported from formcut's
agent_connect.py, the same author's). Every MCP client starts a local server the same way, a command and its arguments,
and formwav's is backend/formwav_mcp/serve (from any working directory; on Windows the server's Python with the module
and PYTHONPATH, since serve is a shell script). This answers with that command for this copy of formwav and the exact
text each client wants, and adds formwav to Claude Code, Codex, Cursor or Claude Desktop in one click: Claude Code
through its own `claude mcp add`, the others by merging into their configuration files, keeping every other server,
leaving a backup beside the file, and refusing a file that is not valid rather than overwriting it. These are the
person's own files: a request through the network listener (a paired device) is refused.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Request

router = APIRouter(prefix="/agents", tags=["agents"])
BACKEND = Path(__file__).resolve().parents[2]
NAME = "formwav"


def server_command() -> tuple[str, list[str], dict[str, str]]:
    """The command an MCP client runs to start formwav's server, its arguments, and any environment it needs."""
    if os.name == "nt":
        return str(BACKEND / "formwav_mcp" / "venv" / "Scripts" / "python.exe"), ["-m", "formwav_mcp.server"], {"PYTHONPATH": str(BACKEND)}
    return str(BACKEND / "formwav_mcp" / "serve"), [], {}


def _line(words: list[str]) -> str:
    return subprocess.list2cmdline(words) if os.name == "nt" else " ".join(shlex.quote(w) for w in words)


def _desktop_file() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", str(Path.home()))) / "Claude" / "claude_desktop_config.json"
    return Path.home() / ".config" / "Claude" / "claude_desktop_config.json"


FILES = {"codex": lambda: Path.home() / ".codex" / "config.toml", "cursor": lambda: Path.home() / ".cursor" / "mcp.json", "claude-desktop": _desktop_file}


def _stdio() -> dict:
    command, args, env = server_command()
    return {"command": command, "args": args, **({"env": env} if env else {})}


def _codex_block() -> str:
    command, args, env = server_command()
    # TOML basic strings take JSON's escapes, so json.dumps quotes Windows paths correctly
    lines = [f"[mcp_servers.{NAME}]", f"command = {json.dumps(command)}", f"args = {json.dumps(args)}"]
    if env:
        lines.append("env = { " + ", ".join(f"{k} = {json.dumps(v)}" for k, v in env.items()) + " }")
    return "\n".join(lines) + "\n"


def _present(client: str) -> bool | None:
    """Whether formwav is already in the client's configuration (None when that cannot be read from here)."""
    if client not in FILES:
        return None
    path = FILES[client]()
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8", errors="replace")
    if client == "codex":
        return f"[mcp_servers.{NAME}]" in text
    try:
        return NAME in (json.loads(text or "{}").get("mcpServers") or {})
    except ValueError:
        return None


def clients() -> list[dict]:
    command, args, env = server_command()
    add = ["claude", "mcp", "add", NAME, "--scope", "user"] + [f for k, v in env.items() for f in ("-e", f"{k}={v}")] + ["--", command, *args]
    return [
        {"id": "claude-code", "name": "Claude Code", "kind": "command", "file": None, "text": _line(add), "installable": shutil.which("claude") is not None, "present": None},
        {"id": "codex", "name": "Codex", "kind": "file", "file": str(FILES["codex"]()), "text": _codex_block(), "installable": True, "present": _present("codex")},
        {"id": "cursor", "name": "Cursor", "kind": "file", "file": str(FILES["cursor"]()), "text": json.dumps({"mcpServers": {NAME: _stdio()}}, indent=2), "installable": True, "present": _present("cursor")},
        {"id": "claude-desktop", "name": "Claude Desktop", "kind": "file", "file": str(_desktop_file()), "text": json.dumps({"mcpServers": {NAME: _stdio()}}, indent=2), "installable": True, "present": _present("claude-desktop")},
        {"id": "vscode", "name": "VS Code", "kind": "file", "file": ".vscode/mcp.json (in your project)", "text": json.dumps({"servers": {NAME: {"type": "stdio", **_stdio()}}}, indent=2), "installable": False, "present": None},
        {"id": "any", "name": "Any other client", "kind": "command", "file": None, "text": _line([command, *args]), "installable": False, "present": None},
    ]


def _refuse_remote(request: Request) -> None:
    if request.scope.get("formwav.remote"):
        raise HTTPException(403, "agents are connected from this computer's formwav, not from a paired device")


@router.get("/connect")
def connect(request: Request) -> dict:
    _refuse_remote(request)
    command, args, env = server_command()
    return {"command": command, "args": args, "env": env, "ready": Path(command).exists(), "clients": clients()}


@router.post("/install")
def install(request: Request, body: dict = Body(...)) -> dict:
    """Adds formwav's server to one client's configuration: the person's own click, never a paired device's."""
    _refuse_remote(request)
    client = str(body.get("client", ""))
    command, args, env = server_command()
    if client == "claude-code":
        claude = shutil.which("claude")
        if not claude:
            raise HTTPException(409, "claude is not on this computer's PATH: install Claude Code first, or paste the command shown")
        run = subprocess.run([claude, "mcp", "add", NAME, "--scope", "user"] + [f for k, v in env.items() for f in ("-e", f"{k}={v}")] + ["--", command, *args], capture_output=True, text=True, timeout=60, check=False)
        text = (run.stdout + run.stderr).strip()
        if run.returncode and "already exists" not in text:
            raise HTTPException(502, f"claude mcp add failed: {text[-400:]}")
        return {"client": client, "written": f"claude mcp add {NAME} --scope user", "present": "already exists" in text}
    if client not in FILES:
        raise HTTPException(400, "client must be claude-code, codex, cursor or claude-desktop")
    path = FILES[client]()
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    if client == "codex":
        block = _codex_block()
        head = f"[mcp_servers.{NAME}]"
        if head in existing:
            before, _, rest = existing.partition(head)
            tail = rest.split("\n[", 1)
            rebuilt = before + block + ("\n[" + tail[1] if len(tail) > 1 else "")
        else:
            rebuilt = existing + ("\n" if existing and not existing.endswith("\n") else "") + ("\n" if existing else "") + block
    else:
        try:
            data = json.loads(existing) if existing.strip() else {}
        except ValueError as err:
            raise HTTPException(409, f"{path} is not valid JSON, so formwav left it alone: fix it or move it aside, then add formwav again") from err
        if not isinstance(data, dict) or not isinstance(data.get("mcpServers", {}), dict):
            raise HTTPException(409, f"{path} does not hold an mcpServers table formwav can add to; it was left alone")
        data.setdefault("mcpServers", {})[NAME] = _stdio()
        rebuilt = json.dumps(data, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if existing:
        backup = path.with_name(path.name + ".bak")
        backup.write_text(existing, encoding="utf-8")
    path.write_text(rebuilt, encoding="utf-8")
    return {"client": client, "written": str(path), "present": _present(client), "backup": str(backup) if backup else None}
