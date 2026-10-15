"""The desktop build's MCP server for clients that only start stdio servers (Claude Desktop, Cursor, Codex): the engine
binary run with --mcp-stdio reads one JSON-RPC message a line and relays it to the running app's POST /mcp, so these
clients reach the open session's tools as Claude Code does over HTTP (PLAN_v14 W6)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PORT_FILE = "engine-port"


def data_dir() -> Path:
    from app.core.paths import data_dir as engine_data_dir

    return engine_data_dir()


def url() -> str:
    if os.environ.get("FORMWAV_MCP_URL"):
        return os.environ["FORMWAV_MCP_URL"]
    try:
        port = int((data_dir() / PORT_FILE).read_text().strip())
    except (OSError, ValueError):
        port = int(os.environ.get("FORMWAV_PORT", "0") or 0) or 8060
    return f"http://127.0.0.1:{port}/mcp"


def relay(line: str, target: str) -> str | None:
    try:
        msg = json.loads(line)
    except ValueError:
        return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "not JSON"}})
    req = urllib.request.Request(target, data=line.encode(), method="POST", headers={"content-type": "application/json", "accept": "application/json", "x-formwav-local": "1"})
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            body = res.read().decode()
    except (urllib.error.URLError, OSError) as err:
        if not isinstance(msg, dict) or msg.get("id") is None:
            return None
        return json.dumps({"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32000, "message": f"formwav is not running at {target} ({err}): open the formwav app, then try again"}})
    return body.strip() or None


def main() -> int:
    target = url()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        out = relay(line, target)
        if out:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
    return 0
