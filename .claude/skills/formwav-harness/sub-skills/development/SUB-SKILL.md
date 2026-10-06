---
name: development
description: "Adding a tool to formwav's MCP server or changing one: the pattern each tool follows, how it is checked against a live engine, and what must change with it. Load when extending or fixing formwav's MCP server."
---

# Development

## Purpose

Keep the server, its checks, this skill and formwav's README telling the same truth. A tool added without its check, or without this skill's reference regenerated, is the drift this sub-skill exists to stop.

## The pattern

Each tool in `backend/formwav_mcp/server.py` is a thin call to a route formwav's engine already serves, so the engine stays the one place work happens and the route's own checks cover it. It is registered with `@mcp.tool` and an annotation saying what it does (reads only, makes media or writes a file, reaches the cloud), it returns plain JSON with `media_id` for media (the `_media` helper), and it fails by raising an error worded as what the person should do next (the `_call` helper does this for the engine's refusals).

## Procedure

Follow `checklists/tool-change.md` in order; it is the release gate's view of a tool change.
