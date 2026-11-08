"""The in-app agent's model turn (owner decision, Sprint D: agent actions and controls).

The open session lives in the browser, so the browser runs the agent's loop and carries out its actions; this route
only forwards one turn of the conversation (system prompt, messages, tool definitions) to the Anthropic Messages API
and returns the reply, so the API key stays in the engine (set in Preferences, or ANTHROPIC_API_KEY in backend/.env)
and never reaches the page. The model is the one chosen in Preferences, else FORMWAV_AGENT_MODEL (claude-sonnet-5-5 by
default); ANTHROPIC_BASE_URL points it elsewhere
(a proxy, or a recording stand-in in tests). Standard library only, in a worker thread, so the engine gains no
dependency.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Request

from ..services import secrets

router = APIRouter()


def _post(url: str, payload: dict, key: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


@router.post("/agent/step")
async def agent_step(request: Request) -> dict:
    key = secrets.get("ANTHROPIC_API_KEY")
    if not key:
        from ..services.providers import env_file

        raise HTTPException(503, f"The agent needs an Anthropic API key: set it in Preferences, Keys and Models, or put ANTHROPIC_API_KEY=... in {env_file()} and restart formwav.")
    try:
        body = await request.json()
        messages = body["messages"]
    except (ValueError, KeyError, TypeError) as err:
        raise HTTPException(422, "send messages (and optionally system and tools) as the Messages API takes them") from err
    payload = {
        "model": secrets.agent_model(),
        "max_tokens": int(body.get("max_tokens", 2048)),
        "system": str(body.get("system", "")),
        "messages": messages,
        "tools": body.get("tools", []),
    }
    base = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    try:
        status, raw = await asyncio.to_thread(_post, f"{base}/v1/messages", payload, key)
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise HTTPException(502, f"The model service could not be reached: {err}") from err
    if status in (401, 403):
        secrets.refused("ANTHROPIC_API_KEY")   # Preferences shows the key refused until it is replaced or cleared
    elif status < 400:
        secrets.accepted("ANTHROPIC_API_KEY")
    if status >= 400:
        raise HTTPException(502, f"The model service answered {status}: {raw[:300].decode(errors='replace')}")
    return json.loads(raw)
