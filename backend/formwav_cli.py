"""formwav's command line over the open session (PLAN_v14 W2): `./formwav cli list [group]`, `./formwav cli describe
<id>`, `./formwav cli run <id> key=value ...` (values read as JSON when they parse, else as text). It speaks to the
engine at FORMWAV_URL or http://127.0.0.1:8060; the commands run in formwav's open window, which asks its person
first. Standard library only, so it runs with any Python 3."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("FORMWAV_URL", "http://127.0.0.1:8060").rstrip("/")


def call(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json", "x-formwav-local": "1", "x-formwav-agent": "formwav's command line"})
    try:
        with urllib.request.urlopen(req, timeout=700) as res:
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        detail = json.loads(err.read() or b"{}").get("detail", err.reason)
        sys.exit(f"formwav: {detail}")
    except urllib.error.URLError:
        sys.exit(f"formwav: the engine is not running at {BASE}; start formwav first")


def value(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return text


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.split("\n\n")[0])
        return 0
    verb, rest = argv[0], argv[1:]
    if verb in ("headless", "commands"):
        # PLAN_v13 S12: with no window, in the engine's own Python (backend/venv): engine commands on a saved session
        here = os.path.dirname(os.path.abspath(__file__))
        python = next((p for p in (os.path.join(here, "venv", "bin", "python"), os.path.join(here, "venv", "Scripts", "python.exe")) if os.path.exists(p)), sys.executable)
        import subprocess

        return subprocess.call([python, "-m", "app.headless", *(rest if verb == "headless" else ["commands", *rest])], cwd=here)
    if verb == "list":
        out = call("GET", "/api/commands" + (f"?group={urllib.parse.quote(rest[0])}" if rest else ""))
        for c in out:
            print(f"{c['id']:<44} {c['label']}" + (f"  [{c['keys']}]" if c.get("keys") else "") + ("  (risky)" if c.get("risky") else ""))
        return 0
    if verb == "describe" and rest:
        print(json.dumps(call("GET", f"/api/commands/{urllib.parse.quote(rest[0])}"), indent=2))
        return 0
    if verb == "run" and rest:
        params = {}
        for pair in rest[1:]:
            if "=" not in pair:
                sys.exit(f"formwav: give parameters as key=value, not {pair}")
            k, v = pair.split("=", 1)
            params[k] = value(v)
        out = call("POST", f"/api/commands/{urllib.parse.quote(rest[0])}", {"params": params})
        print(json.dumps(out, indent=2))
        return 0 if out.get("ok") else 1
    sys.exit("formwav: cli list [group] | describe <id> | run <id> key=value ... | commands [words] | headless run (--in FILE.fmw | --demo) [--cmd JSON]... [--bounce OUT.wav] [--save OUT.fmw] [--inspect]")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
