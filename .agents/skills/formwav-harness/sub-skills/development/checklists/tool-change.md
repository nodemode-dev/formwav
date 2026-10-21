# Tool change

**The tool**
- [ ] It calls an engine route that exists and has its own check, rather than doing the work in the server
- [ ] Its name starts with formwav_ and says what it does; its description says when to use it and what it needs
- [ ] Its annotation is right: reads only, makes media or writes a file, or reaches the cloud
- [ ] A missing key, install or device fails with what the person must do

**The checks**
- [ ] The MCP check calls it through the MCP SDK's client: its result where it can run, its instruction where it cannot (the check is `verification/verify_mcp.py` in formwav's planning sidecar until Phase 4 moves the checks into this repository)
- [ ] The tool count asserted there matches the server's
- [ ] The whole verification passes against a running engine

**What changes with it**
- [ ] This skill's `sub-skills/tools/references/tools.md` regenerated from the server (the generator refuses when its groups and the server disagree)
- [ ] A workflow in `sub-skills/workflows/references/workflows.md` updated if the tool changes how a job is done
- [ ] formwav's README states the new tool count; the claims audit checks it against the server
- [ ] The skill validated again and repackaged
