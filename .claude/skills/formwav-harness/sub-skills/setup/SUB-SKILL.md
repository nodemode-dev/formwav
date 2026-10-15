---
name: setup
description: "Connects formwav's MCP server to Claude Code, Codex, Cursor or Claude Desktop, over stdio or Streamable HTTP, and troubleshoots tools that do not appear or calls that fail. Load when setting up formwav with an agent or when its tools are missing."
---

# Setup

## Purpose

Get the 28 tools in front of the agent. The server is `backend/formwav_mcp/serve` in the formwav repository: it starts from any working directory, speaks stdio by default, and Streamable HTTP on 127.0.0.1:8061/mcp with `--http`. It reaches formwav's engine at `FORMWAV_ENGINE` (default http://127.0.0.1:8060), so formwav must be running.

## The quickest way

In formwav, Settings > Agents adds formwav to Claude Code, Codex, Cursor or Claude Desktop in one click, merging into the client's own configuration beside its other servers and keeping the previous file as a backup; it also shows each client's exact text to copy. Restart the client afterwards. In the installed desktop app the stdio command is the app's own engine with `--mcp-stdio`, which relays to the running app's session tools (the window's, not the 28 here), so the app must be open; Claude Code connects to the app over HTTP at `/mcp` instead.

## Per client, by hand

Replace FORMWAV with the path to the formwav repository.

- **Claude Code:** `claude mcp add formwav -- FORMWAV/backend/formwav_mcp/serve`. Over HTTP instead: start `serve --http`, then `claude mcp add --transport http formwav http://127.0.0.1:8061/mcp`.
- **Codex:** in `~/.codex/config.toml`, a table `[mcp_servers.formwav]` with `command = "FORMWAV/backend/formwav_mcp/serve"`.
- **Cursor:** in `.cursor/mcp.json` of the project (or the user's), `{"mcpServers": {"formwav": {"command": "FORMWAV/backend/formwav_mcp/serve"}}}`.
- **Claude Desktop:** the same `mcpServers` entry in `claude_desktop_config.json`.

Then call `formwav_status`: it answers with the engine's version when everything is connected.

## When it does not work

Work through `checklists/connection-troubleshooting.md` in order. The first two steps resolve most cases and neither is a skill problem.
