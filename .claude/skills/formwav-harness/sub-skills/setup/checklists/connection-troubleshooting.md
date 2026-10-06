# Connection troubleshooting

Work in order.

**1. Is formwav running**
- [ ] formwav is open, or its engine started (`backend/boot_backend`)
- [ ] http://127.0.0.1:8060/api/health answers in a browser on the same machine

**2. Is the server installed**
- [ ] `backend/formwav_mcp/venv` exists (formwav's installer makes it); if not, run the installer again
- [ ] `backend/formwav_mcp/serve` is executable

**3. Is the client configured**
- [ ] The client's configuration names `backend/formwav_mcp/serve` by its full path
- [ ] The client was restarted or reloaded after the change
- [ ] `FORMWAV_ENGINE` is set only when the engine listens elsewhere than http://127.0.0.1:8060

**4. Isolate the server from the skill**
- [ ] Called `formwav_status` directly, without this skill
- [ ] If that fails, the problem is the connection or the engine, and is recorded as such

**5. Are the tool names right**
- [ ] The client lists 28 tools whose names start with formwav_
- [ ] Every name used matches `sub-skills/tools/references/tools.md` exactly, case included
- [ ] `formwav_status` reports the version the reference was generated for; regenerate it if not

**6. Only now, is it the workflow**
- [ ] Each step's inputs come from an earlier step's results
