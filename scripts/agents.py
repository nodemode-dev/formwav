#!/usr/bin/env python3
"""Writes agents/manifest.json, what formwav offers agents, from the code that decides it; `--check` fails when the file
on disk is not what a write would produce.

    python3 scripts/agents.py sync            writes agents/manifest.json
    python3 scripts/agents.py sync --check    exits 1 and names the file when it is out of date

Read from source with no import of the engine or of the MCP SDK: the tool names, annotations, the app name and the
transports from backend/formwav_mcp/server.py; which tools wait for the person's Allow from the gate's own data in
backend/app/core/window_key.py (READS, WINDOW_ONLY) and the calls each tool makes; the skills from .claude/skills; the
form.ext host API from backend/app/services/formext_host.py. The dock is the one declared value (DOCK below).
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "agents" / "manifest.json"
SERVER = ROOT / "backend" / "formwav_mcp" / "server.py"
GATE = ROOT / "backend" / "app" / "core" / "window_key.py"
EXTENSIONS = ROOT / "backend" / "app" / "services" / "formext_host.py"
SKILLS = ROOT / ".claude" / "skills"
TRANSPORT_NAMES = {"stdio": "stdio", "streamable-http": "http"}
DOCK = {
    "present": True,
    "positions": ["bottom", "right"],
    "tabs": ["chat", "terminal", "claude", "codex", "cursor", "antigravity"],
}
DOCK_FOLDER = ROOT / "frontend" / "src" / "dock"
LOOKUP = ROOT / "backend" / "app" / "services" / "agent_lookup.py"
LOOKUP_HASHES = {"1.0.0": "252ea9bb9419d4990f174f91914f09800497bc69e98f849f5643bbf4217cc3f3", "1.0.1": "62667f9b68b7d101e1896ce617240424e33b7e498c560bc79d45f0ab26c77d51"}


def lookup_problems() -> list[str]:
    import hashlib
    import re

    rel = LOOKUP.relative_to(ROOT).as_posix()
    try:
        raw = LOOKUP.read_bytes()
    except OSError:
        return [f"{rel}: missing (the shared finder for the agent programs)"]
    said = re.search(rb'^VERSION = "([^"\r\n]+)"\r?$', raw, re.M)
    version = said.group(1).decode("ascii", "replace") if said else "unknown"
    if LOOKUP_HASHES.get(version) != hashlib.sha256(raw).hexdigest():
        return [f"{rel}: does not match the hash recorded for version {version} (the shared finder changes only as a whole new version)"]
    return []


def dock_problems() -> list[str]:
    import hashlib
    import re

    shown = DOCK_FOLDER.relative_to(ROOT).as_posix()
    listed = DOCK_FOLDER / "MANIFEST.json"
    if not listed.is_file():
        return [f"{shown}/MANIFEST.json is missing"]
    files = json.loads(listed.read_text(encoding="utf-8")).get("files", {})
    found = []
    for name, wanted in sorted(files.items()):
        path = DOCK_FOLDER / name
        if not path.is_file():
            found.append(f"{shown}/{name} is missing")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != wanted:
            found.append(f"{shown}/{name} does not match MANIFEST.json; the shared dock folder is copied from formvis and never edited here")
    for path in sorted(DOCK_FOLDER.iterdir()):
        if path.name != "MANIFEST.json" and path.name not in files:
            found.append(f"{shown}/{path.name} is not a file of the shared dock (MANIFEST.json does not list it)")
        if path.suffix == ".ts" and re.search(r"""(?:from|import)\s*\(?\s*['"]\.\./""", path.read_text(encoding="utf-8")):
            found.append(f"{shown}/{path.name} imports from outside the dock folder")
    return found


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _assigned(tree: ast.Module, name: str) -> ast.expr:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node.value
    raise SystemExit(f"{name} is not assigned at the top of the module the manifest reads it from")


def _keywords(call: ast.Call) -> dict[str, ast.expr]:
    return {k.arg: k.value for k in call.keywords if k.arg}


def _is_tool(dec: ast.expr) -> ast.Call | None:
    if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr == "tool" and isinstance(dec.func.value, ast.Name) and dec.func.value.id == "mcp":
        return dec
    return None


def _annotation(tree: ast.Module, node: ast.expr | None) -> dict[str, object]:
    if isinstance(node, ast.Name):
        node = _assigned(tree, node.id)
    if not isinstance(node, ast.Call):
        return {}
    return {k: ast.literal_eval(v) for k, v in _keywords(node).items()}


def _literal_head(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr) and node.values and isinstance(node.values[0], ast.Constant):
        return str(node.values[0].value)
    return None


def _gate() -> tuple[tuple[str, ...], tuple[str, ...]]:
    tree = _tree(GATE)
    return tuple(ast.literal_eval(_assigned(tree, "READS"))), tuple(ast.literal_eval(_assigned(tree, "WINDOW_ONLY")))


def _asks(body: ast.AsyncFunctionDef, reads: tuple[str, ...], window_only: tuple[str, ...]) -> bool:
    asked = False
    for node in ast.walk(body):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
            continue
        fn, args = node.func.id, node.args
        if fn == "_post":
            method, path = "POST", _literal_head(args[0]) if args else None
        elif fn == "_call":
            method, path = _literal_head(args[0]) if args else None, _literal_head(args[1]) if len(args) > 1 else None
            if method is None:
                raise SystemExit(f"{body.name}: a request method that is not a literal cannot be read for the gate")
        elif fn == "_window":
            if _literal_head(args[0] if args else None) == "tools/call":
                asked = True
            continue
        else:
            continue
        if method not in reads:
            if path and path.startswith("/api/") and any(path == p or path.startswith(p + "/") for p in window_only):
                raise SystemExit(f"{body.name}: {path} is for the window only, which an agent's call is refused rather than asked about")
            asked = True
        elif path and path.startswith("/api/commands"):
            asked = True
    return asked


def mcp() -> dict[str, object]:
    tree = _tree(SERVER)
    reads, window_only = _gate()
    tools: list[str] = []
    read_only: list[str] = []
    gated: list[str] = []
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for dec in node.decorator_list:
            call = _is_tool(dec)
            if call is None:
                continue
            given = _keywords(call)
            name = ast.literal_eval(given["name"]) if "name" in given else node.name
            tools.append(name)
            if _annotation(tree, given.get("annotations")).get("read_only_hint") is True:
                read_only.append(name)
            if _asks(node, reads, window_only):
                gated.append(name)
    transports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "run" and isinstance(node.func.value, ast.Name) and node.func.value.id == "mcp":
            kind = _keywords(node).get("transport")
            if kind is not None and ast.literal_eval(kind) in TRANSPORT_NAMES and TRANSPORT_NAMES[ast.literal_eval(kind)] not in transports:
                transports.append(TRANSPORT_NAMES[ast.literal_eval(kind)])
    transports.sort(key=("stdio", "http").index)
    return {"tools": tools, "read_only": read_only, "approval_gated": gated, "transports": transports}


def app_name() -> str:
    for node in ast.walk(_tree(SERVER)):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "mcp" for t in node.targets) and isinstance(node.value, ast.Call):
            return str(ast.literal_eval(_keywords(node.value)["name"]))
    raise SystemExit("backend/formwav_mcp/server.py does not create `mcp = MCPServer(name=...)`")


def skills() -> list[dict[str, object]]:
    found = []
    for folder in sorted(p for p in SKILLS.iterdir() if p.is_dir()):
        subs = folder / "sub-skills"
        found.append({"name": folder.name, "sub_skills": sorted(p.name for p in subs.iterdir() if p.is_dir()) if subs.is_dir() else []})
    return found


def extensions() -> dict[str, str]:
    return {"host_api": str(ast.literal_eval(_assigned(_tree(EXTENSIONS), "API")))}


def manifest() -> dict[str, object]:
    return {"format": "form-agent-manifest", "version": 1, "app": app_name(), "mcp": mcp(), "skills": skills(), "dock": DOCK, "extensions": extensions()}


def text() -> str:
    return json.dumps(manifest(), indent=2) + "\n"


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "sync" or any(a != "--check" for a in argv[1:]):
        print("usage: agents.py sync [--check]", file=sys.stderr)
        return 2
    wrong = dock_problems() + lookup_problems()
    if wrong:
        print("\n".join(wrong), file=sys.stderr)
        return 1
    wanted = text()
    shown = TARGET.relative_to(ROOT).as_posix()
    if "--check" in argv:
        if not TARGET.is_file() or TARGET.read_text(encoding="utf-8") != wanted:
            print(f"{shown} is not what `agents sync` writes; run `./formwav agents sync` and commit the result", file=sys.stderr)
            return 1
        print(f"{shown} is current")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(wanted, encoding="utf-8")
    print(f"wrote {shown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
