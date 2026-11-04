import collections
import json
import os
import re
import sys
import tomllib

from app.core.version import VERSION
from conftest import ROOT


def _lock(path, name: str) -> str:
    return next(p["version"] for p in tomllib.loads((ROOT / path).read_text(encoding="utf-8"))["package"] if p["name"] == name)


def _match(path, pattern: str) -> str:
    return re.search(pattern, (ROOT / path).read_text(encoding="utf-8"), re.M).group(1)


def test_the_engine_imports_and_mounts_each_route_once():
    from app.main import app

    paths = [f"{method} {route.path}" for route in app.routes for method in sorted(getattr(route, "methods", None) or {"GET"})]
    assert [p for p, n in collections.Counter(paths).items() if n > 1] == []


def test_the_version_is_written_as_formwav_writes_versions():
    assert re.fullmatch(r"\d+\.(\d|[1-9]\d)\.\d", VERSION)


def test_every_version_site_states_the_same_version():
    package_lock = json.loads((ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8"))
    sites = {
        "backend/formwav_mcp/server.py": _match("backend/formwav_mcp/server.py", r'^VERSION = "([^"]+)"'),
        "frontend/package.json": json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))["version"],
        "frontend/package-lock.json": package_lock["version"],
        "frontend/package-lock.json, its root package": package_lock["packages"][""]["version"],
        "native/formwav-dsp/Cargo.toml": tomllib.loads((ROOT / "native" / "formwav-dsp" / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"],
        "native/formwav-dsp/Cargo.lock": _lock("native/formwav-dsp/Cargo.lock", "formwav-dsp"),
        "native/formwav-clap/Cargo.lock": _lock("native/formwav-clap/Cargo.lock", "formwav-dsp"),
        "spikes/audio/Cargo.lock": _lock("spikes/audio/Cargo.lock", "formwav-dsp"),
        "src-tauri/Cargo.toml": tomllib.loads((ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"],
        "src-tauri/Cargo.lock": _lock("src-tauri/Cargo.lock", "formwav-desktop"),
        "src-tauri/tauri.conf.json": json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["version"],
        "README.md, the badge": _match("README.md", r"badge/version-([0-9.]+)-"),
        "README.md, the badge's text": _match("README.md", r'alt="version ([0-9.]+)"'),
        "backend/HASHOUT_LOG.md": _match("backend/HASHOUT_LOG.md", r"^Current build version: v(\S+)"),
        "frontend/HASHOUT_LOG.md": _match("frontend/HASHOUT_LOG.md", r"^Current build version: v(\S+)"),
        "native/HASHOUT_LOG.md": _match("native/HASHOUT_LOG.md", r"^Current build version: v(\S+)"),
    }
    assert {site: v for site, v in sites.items() if v != VERSION} == {}


def test_the_engine_reports_its_version_and_the_core_it_was_built_with(client):
    health = client.get("/api/health").json()
    assert health["version"] == VERSION
    assert health["core"] == VERSION, "the audio core installed in this environment was built from another version of native/formwav-dsp"


def test_the_engine_refuses_another_machine_a_rebinding_page_and_a_change_without_its_header(client):
    from fastapi.testclient import TestClient

    from app.main import app

    elsewhere = TestClient(app, base_url="http://127.0.0.1:8060", headers={"x-formwav-local": "1"}, client=("203.0.113.7", 50000))
    assert elsewhere.get("/api/health").status_code == 403
    assert client.get("/api/health", headers={"host": "attacker.example:8060"}).json() == {"detail": "refused: unexpected Host header"}
    refused = TestClient(app, base_url="http://127.0.0.1:8060").post("/api/generate", params={"kind": "tone", "seconds": 1})
    assert refused.status_code == 403 and "x-formwav-local" in refused.json()["detail"]
    assert client.get("/api/health").headers["x-content-type-options"] == "nosniff"


def test_the_desktop_engine_listens_on_this_machine_only(monkeypatch):
    import uvicorn

    import desktop_entry

    served = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: served.update(options))
    monkeypatch.setattr(sys, "argv", ["formwav-engine"])
    monkeypatch.setenv("PATH", os.environ.get("PATH", ""))
    monkeypatch.setenv("FORMWAV_DIST", str(ROOT / "frontend" / "dist"))
    assert desktop_entry.main() == 0
    assert served["host"] == "127.0.0.1"
