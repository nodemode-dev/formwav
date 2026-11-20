"""Claude Code inside formwav: the user's own `claude` program, run with their own login, given formwav's tools.

Two ways in, both the same program: the Agent column's chat runs `claude -p ... --output-format stream-json` once per
message and streams what it says and does; the terminal's Claude Code button runs `claude` interactively in a PTY.
Both get formwav's MCP server through `--mcp-config`, a 0600 file naming the engine's own /mcp over HTTP and a token
made fresh for that one tab or chat run, removed when it ends, so the window can tell its own Claude from an outside
agent.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import time
from pathlib import Path

from . import agent_lookup

TOKENS: dict[str, Path | None] = {}
KEEP = agent_lookup.KEEP_ENV
OVERRIDES = {"claude": ("FORMWAV_CLAUDE_BIN",), "codex": ("FORMWAV_CODEX_BIN",), "cursor": ("FORMWAV_CURSOR_BIN",), "antigravity": ("FORMWAV_ANTIGRAVITY_BIN",)}
SHELL_WAIT = 10.0
CHECK_WAIT = 15.0
OTHERWISE = ""
DROP = {"ANTHROPIC_API_KEY", "FORMWAV_PORT", "FORMWAV_EXIT_WITH_STDIN", "FORMWAV_DATA_DIR", "FORMWAV_DIST"}
TAB_ENTRY = "formwav_tab"
INSTALL = "Claude Code is not installed: install it from https://claude.com/claude-code, run claude once in a terminal to sign in, then try again."
NOTE = (
    "You are working inside formwav, an audio editor, on the session the user has open. Its tools (mcp__formwav_tab__* in a tab formwav started, mcp__formwav__* elsewhere) act "
    "on that session: call get_session first for the track and clip ids; times are seconds and levels dB. Measure with "
    "analyze_clip before changing levels or repairing. Make the smallest set of changes that does what was asked; every "
    "change is one undo step in formwav's History. Finish with one or two sentences on what you changed."
)

_info: dict = {"at": 0.0, "value": None}


def setting(kind: str) -> str | None:
    return None


def located(kind: str, fresh: bool = False) -> agent_lookup.Found:
    """One of the agent programs, found by the family's finder (FORMWAV_*_BIN, the engine's PATH, the known install
    folders, then the person's shell PATH) and asked for its version in the environment a tab would give it."""
    found = agent_lookup.find(kind, setting=setting(kind), override_vars=OVERRIDES.get(kind, ()), shell_timeout=SHELL_WAIT, fresh=fresh)
    return agent_lookup.check(found, child_env(found.path), CHECK_WAIT, fresh)


def usable(kind: str) -> agent_lookup.Found:
    found = located(kind)
    return found if found.state == "runs" else located(kind, fresh=True)


def said(found: agent_lookup.Found) -> str:
    return agent_lookup.sentence(found, agent_lookup.install(found.program), OTHERWISE)


def cli() -> str | None:
    return located("claude").path


def info(fresh: bool = False) -> dict:
    """Whether Claude Code is here and starts, where, which version and the sentence that says so; kept for a minute."""
    if not fresh and _info["value"] is not None and time.monotonic() - _info["at"] < 60:
        return _info["value"]
    found = located("claude", fresh)
    value = agent_lookup.answer(found, agent_lookup.install("claude"), OTHERWISE) | {"workdir": str(workdir()), "message": None if found.state == "runs" else said(found)}
    _info.update(at=time.monotonic(), value=value)
    return value


def child_env(path: str | None = None) -> dict[str, str]:
    """The environment Claude Code, the other agent programs and the terminal's shell start with: the finder's (the
    program's own folder, the person's shell PATH and the known install folders in front of the engine's PATH, a
    nested Claude Code session's variables left out, the library path a frozen engine changed put back), less what
    would change who pays or where things go (an API key from formwav's .env would bill per token instead of the
    user's plan; the engine's own settings)."""
    base = {k: v for k, v in os.environ.items() if k not in DROP}
    return agent_lookup.child_env(path, base=base, extra={"TERM": "xterm-256color", "COLORTERM": "truecolor", "FORMWAV_TERMINAL": "1"}, shell_timeout=SHELL_WAIT)


def workdir() -> Path:
    """Where Claude Code runs: FORMWAV_AGENT_DIR, else ~/formwav/Agent, made if missing."""
    path = Path(os.environ.get("FORMWAV_AGENT_DIR") or (Path.home() / "formwav" / "Agent"))
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return Path.home()
    return path


def issue(base: str) -> tuple[str, str]:
    from ..core.paths import data_dir

    token = secrets.token_urlsafe(32)
    folder = data_dir() / "AgentTokens"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = folder / f"mcp-{secrets.token_hex(8)}.json"
    body = json.dumps({"mcpServers": {TAB_ENTRY: {"type": "http", "url": f"{base}/mcp", "headers": {"x-formwav-inapp": token}}}})
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(body)
    TOKENS[token] = path
    return token, str(path)


def issue_token() -> str:
    token = secrets.token_urlsafe(32)
    TOKENS[token] = None
    return token


def revoke(token: str) -> None:
    path = TOKENS.pop(token, None)
    if path is not None:
        try:
            path.unlink()
        except OSError:
            pass


def is_inapp(value) -> bool:
    if not isinstance(value, str) or not value:
        return False
    return any(hmac.compare_digest(value.encode("utf-8"), t.encode("utf-8")) for t in list(TOKENS))


def argv(prompt: str | None = None, resume: str | None = None, print_mode: bool = False, mcp_file: str = "") -> list[str]:
    """The `claude` command line: formwav's tools inline and allowed, the note on working in formwav, a resumed session
    when there is one, and for the chat the streaming print mode."""
    found = usable("claude")
    if found.state != "runs":
        raise FileNotFoundError(said(found))
    args = [found.path]
    if print_mode:
        args += ["-p", prompt or "", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    args += ["--mcp-config", mcp_file, "--allowedTools", f"mcp__{TAB_ENTRY}", "--append-system-prompt", NOTE]
    if resume:
        args += ["--resume", resume]
    if prompt and not print_mode:
        args.append(prompt)
    return args


def shell_wrapped(args: list[str]) -> list[str]:
    """On macOS and Linux through a login shell, so the user's PATH (node, npm) applies; on Windows as it is, with
    the command interpreter in front of a .cmd or .bat."""
    return agent_lookup.start_argv(args)
