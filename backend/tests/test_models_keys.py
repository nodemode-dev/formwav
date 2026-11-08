"""Preferences' engine side (2.25.0): the keys set from the window and where they are kept, the agent's model, and the
models on this computer (what they take, Remove, Open folder). A key must never come back out of the engine."""

import json
import os
import stat
import sys

import pytest

from app.services import models_disk, secrets

H = {"x-formwav-local": "1"}
KEY = "sk-test-0123456789abcdef"


class FakeStore:
    """A password store in memory, as keyring's backends answer."""

    def __init__(self):
        self.items = {}

    def set_password(self, service, name, value):
        self.items[(service, name)] = value

    def get_password(self, service, name):
        return self.items.get((service, name))

    def delete_password(self, service, name):
        self.items.pop((service, name), None)


@pytest.fixture()
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FORMWAV_MODELS_ROOT", str(tmp_path / "models"))
    for name in secrets.KEYS:
        monkeypatch.delenv(name, raising=False)
    secrets._held.clear()
    secrets._asked.clear()
    secrets._refused.clear()
    monkeypatch.setattr(secrets, "_store", lambda: None)
    yield tmp_path
    secrets._held.clear()
    secrets._asked.clear()
    secrets._refused.clear()


def test_a_key_is_kept_in_a_file_only_the_user_reads_and_never_comes_back(client, data):
    got = client.put("/api/keys/FAL_KEY", json={"value": KEY}, headers=H)
    assert got.status_code == 200
    assert got.json() == {"kept": "file", "set": True, "source": "file", "last4": KEY[-4:], "refused": False, "refusedAt": 0}
    assert KEY not in client.get("/api/keys").text
    path = data / "data" / "keys-file.json"
    assert json.loads(path.read_text()) == {"FAL_KEY": KEY}
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert secrets.get("FAL_KEY") == KEY
    listed = {k["name"]: k for k in client.get("/api/keys").json()["keys"]}
    assert listed["FAL_KEY"]["set"] and not listed["ELEVENLABS_API_KEY"]["set"]
    assert client.get("/api/providers").json()["providers"][1]["ready"] is True
    gone = client.delete("/api/keys/FAL_KEY", headers=H)
    assert gone.json()["set"] is False and not path.read_text().count("FAL_KEY")
    assert client.get("/api/providers").json()["providers"][1]["ready"] is False


def test_a_key_goes_to_the_system_password_store_when_there_is_one(client, data, monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(secrets, "_store", lambda: store)
    got = client.put("/api/keys/ELEVENLABS_API_KEY", json={"value": f" {KEY} "}, headers=H).json()
    assert got["kept"] == "system" and got["source"] == "system" and got["last4"] == KEY[-4:]
    assert store.items == {("formwav", "ELEVENLABS_API_KEY"): KEY}
    assert not (data / "data" / "keys-file.json").exists()
    assert KEY not in (data / "data" / "keys.json").read_text()
    secrets._held.clear()
    assert secrets.get("ELEVENLABS_API_KEY") == KEY
    client.delete("/api/keys/ELEVENLABS_API_KEY", headers=H)
    assert store.items == {} and secrets.get("ELEVENLABS_API_KEY") == ""


def test_the_environment_overrides_a_saved_key_as_formvis_does(client, data, monkeypatch):
    client.put("/api/keys/ANTHROPIC_API_KEY", json={"value": KEY}, headers=H)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-the-env-file")
    listed = {k["name"]: k for k in client.get("/api/keys").json()["keys"]}
    assert listed["ANTHROPIC_API_KEY"]["source"] == "environment" and listed["ANTHROPIC_API_KEY"]["last4"] == "file"
    assert secrets.get("ANTHROPIC_API_KEY") == "from-the-env-file"
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert secrets.get("ANTHROPIC_API_KEY") == KEY
    client.delete("/api/keys/ANTHROPIC_API_KEY", headers=H)
    assert secrets.get("ANTHROPIC_API_KEY") == ""


def test_the_key_list_names_every_key_the_engine_sends_with_a_link_to_get_one(client, data):
    got = client.get("/api/keys").json()
    listed = {k["name"]: k for k in got["keys"]}
    assert list(listed) == ["ELEVENLABS_API_KEY", "FAL_KEY", "ANTHROPIC_API_KEY", "ACESTEP_API_KEY"]
    assert listed["FAL_KEY"]["link"] == "https://fal.ai/dashboard/keys" and listed["ACESTEP_API_KEY"]["link"] == ""
    assert got["store"] == "file" and not listed["FAL_KEY"]["set"]


def test_a_file_key_moves_to_the_password_store_on_first_use(client, data, monkeypatch):
    client.put("/api/keys/FAL_KEY", json={"value": KEY}, headers=H)
    store = FakeStore()
    monkeypatch.setattr(secrets, "_store", lambda: store)
    assert secrets.summary("FAL_KEY")["source"] == "file" and store.items == {}
    assert secrets.get("FAL_KEY") == KEY
    assert store.items == {("formwav", "FAL_KEY"): KEY}
    assert "FAL_KEY" not in json.loads((data / "data" / "keys-file.json").read_text())
    assert secrets.summary("FAL_KEY")["source"] == "system"


def test_a_key_an_earlier_version_left_in_the_store_is_asked_for_once(data, monkeypatch):
    store = FakeStore()
    asked = []
    real = store.get_password
    store.get_password = lambda s, n: asked.append(n) or real(s, n)
    monkeypatch.setattr(secrets, "_store", lambda: store)
    assert secrets.get("FAL_KEY") == "" and secrets.get("FAL_KEY") == ""
    assert asked == ["FAL_KEY"]
    store.items[("formwav", "ELEVENLABS_API_KEY")] = KEY
    assert secrets.get("ELEVENLABS_API_KEY") == KEY and secrets.summary("ELEVENLABS_API_KEY")["last4"] == KEY[-4:]


def test_a_refused_key_shows_refused_until_it_is_replaced_and_the_status_never_asks_the_store(client, data, monkeypatch):
    from app.services import providers

    client.put("/api/keys/ELEVENLABS_API_KEY", json={"value": KEY}, headers=H)
    with pytest.raises(providers.ProviderError):
        providers._ok("ElevenLabs", 401, b"invalid api key")
    got = {k["name"]: k for k in client.get("/api/keys").json()["keys"]}["ELEVENLABS_API_KEY"]
    assert got["refused"] is True and got["refusedAt"] > 0
    client.put("/api/keys/ELEVENLABS_API_KEY", json={"value": KEY[::-1]}, headers=H)
    assert secrets.summary("ELEVENLABS_API_KEY")["refused"] is False
    providers._ok("ElevenLabs", 401 - 201, b"{}")
    assert secrets.summary("ELEVENLABS_API_KEY")["refused"] is False
    store = FakeStore()
    store.get_password = lambda s, n: pytest.fail("a status check asked the password store")
    monkeypatch.setattr(secrets, "_store", lambda: store)
    client.get("/api/keys")


def test_a_key_with_spaces_is_refused_before_it_is_kept(client, data):
    got = client.put("/api/keys/FAL_KEY", json={"value": "two words"}, headers=H)
    assert got.status_code == 422 and "fal" in got.json()["detail"]


def test_a_key_route_refuses_an_unknown_name_an_empty_value_and_a_local_header_it_lacks(client, data):
    assert client.put("/api/keys/HOME", json={"value": KEY}, headers=H).status_code == 404
    assert client.put("/api/keys/FAL_KEY", json={"value": "  "}, headers=H).status_code == 422
    assert client.put("/api/keys/FAL_KEY", json={"value": KEY}, headers={"x-formwav-local": "0"}).status_code in (400, 403)
    assert client.delete("/api/keys/NOPE", headers=H).status_code == 404


def test_the_agent_model_is_the_one_chosen_else_the_environment_else_the_default(client, data, monkeypatch):
    assert client.get("/api/keys").json()["agentModel"] == secrets.DEFAULT_AGENT_MODEL
    monkeypatch.setenv("FORMWAV_AGENT_MODEL", "from-env")
    assert secrets.agent_model() == "from-env"
    assert client.put("/api/settings/agent-model", json={"model": "claude-test-1"}, headers=H).json() == {"agentModel": "claude-test-1"}
    assert client.get("/api/keys").json()["agentModel"] == "claude-test-1"
    assert client.put("/api/settings/agent-model", json={"model": "two words"}, headers=H).status_code == 422
    assert client.put("/api/settings/agent-model", json={"model": ""}, headers=H).json() == {"agentModel": "from-env"}


def test_the_disk_route_counts_the_models_folder(client, data):
    models = data / "models"
    (models / "tiger-dnr").mkdir(parents=True)
    (models / "tiger-dnr" / "w.bin").write_bytes(b"x" * 1234)
    got = client.get("/api/models/disk").json()
    assert got["folder"] == str(models) and got["bytes"] == 1234 and got["exists"] is True


def test_remove_deletes_an_engines_files_only_inside_the_models_folder(client, data, monkeypatch):
    models = data / "models"
    outside = data / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("mine")
    (models / "tiger-dnr").mkdir(parents=True)
    (models / "tiger-dnr" / "w.bin").write_bytes(b"x")
    (models / "kokoro").mkdir()
    for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin", "unrelated.txt"):
        (models / "kokoro" / name).write_bytes(b"x")
    (models / "soulx-singer" / "code").mkdir(parents=True)
    (models / "soulx-singer" / "voices").mkdir()
    (models / "soulx-singer" / "voices" / "own_a.wav").write_bytes(b"x")
    calls = []
    monkeypatch.setattr(models_disk, "_uninstall_package", lambda engine: calls.append(engine))
    assert client.delete("/api/providers/local-speech/tiger", headers=H).json() == {"removed": "tiger"}
    assert not (models / "tiger-dnr").exists()
    client.delete("/api/providers/local-speech/kokoro", headers=H)
    assert sorted(p.name for p in (models / "kokoro").iterdir()) == ["unrelated.txt"] and calls == ["kokoro"]
    client.delete("/api/providers/local-speech/soulx-singer", headers=H)
    assert not (models / "soulx-singer" / "code").exists() and (models / "soulx-singer" / "voices" / "own_a.wav").exists()
    assert client.delete("/api/providers/local-speech/nothing", headers=H).status_code == 404
    assert (outside / "keep.txt").read_text() == "mine"


def test_remove_never_follows_a_link_out_of_the_models_folder(client, data):
    models = data / "models"
    outside = data / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("mine")
    models.mkdir()
    try:
        (models / "ezaudio").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("this computer does not allow symbolic links")
    assert client.delete("/api/providers/local-speech/ezaudio", headers=H).status_code == 200
    assert (outside / "keep.txt").read_text() == "mine" and not (models / "ezaudio").exists()


def test_the_delete_check_refuses_the_folder_itself_and_anything_outside_it(data):
    models = data / "models"
    models.mkdir()
    for bad in (models, data / "somewhere-else", models / ".." / "data"):
        with pytest.raises(models_disk.ProviderError):
            models_disk._delete(bad)
    assert models.is_dir()


def test_remove_waits_for_an_install_and_a_dubbing_pair_is_removed_by_its_language(client, data, monkeypatch):
    from app.services import local_dub, local_speech

    monkeypatch.setitem(local_speech._installing, "chatterbox", "installing: PyTorch (CPU build)")
    assert client.delete("/api/providers/local-speech/chatterbox", headers=H).status_code == 409
    pair = data / "models" / "translate" / "en_es" / "model"
    pair.mkdir(parents=True)
    (pair / "model.bin").write_bytes(b"x")
    assert client.delete("/api/providers/local-dub/es", headers=H).json() == {"removed": "es"}
    assert not (data / "models" / "translate" / "en_es").exists()
    assert client.delete("/api/providers/local-dub/zz", headers=H).status_code == 404
    assert "es" in local_dub.LANGS


def test_open_folder_makes_the_folder_and_hands_it_to_the_file_manager(client, data, monkeypatch):
    opened = []
    monkeypatch.setattr(models_disk.subprocess, "Popen", lambda command, **kw: opened.append(command))
    got = client.post("/api/models/open-folder", headers=H).json()
    assert got == {"opened": str(data / "models")} and (data / "models").is_dir()
    assert opened[0][-1] == str(data / "models") and opened[0][0] == {"darwin": "open", "win32": "explorer"}.get(sys.platform, "xdg-open")


def test_every_model_row_carries_its_download_size_and_install_time_from_one_table(client, data, monkeypatch):
    from app.services import model_sizes

    monkeypatch.setattr(model_sizes, "_torch_present", lambda: False)
    engines = {e["id"]: e for e in client.get("/api/providers/local-speech").json()["engines"]}
    assert set(engines) == set(model_sizes.TABLE) - {"dub"}
    gb = lambda e: engines[e]["download"]["bytes"] / 1e9
    assert gb("kokoro") == 0.57 and gb("chatterbox") == 7.8 and gb("acestep") == 4.7
    assert round(gb("soulx-singer"), 2) == 3.72 and round(gb("ezaudio"), 1) == 6.6 and gb("tiger") == 0.917
    assert engines["pocket"]["download"]["measured"] is False and engines["kokoro"]["download"]["measured"] is True
    assert engines["acestep"]["download"]["estimates"] == {"50": 752 + 300, "200": 188 + 300}
    assert engines["tiger"]["progress"] is None
    monkeypatch.setattr(model_sizes, "_torch_present", lambda: True)
    shared = {e["id"]: e for e in client.get("/api/providers/local-speech").json()["engines"]}
    assert shared["soulx-singer"]["download"]["bytes"] == 2_820_000_000 and shared["kokoro"]["download"]["bytes"] == 570_000_000
    langs = client.get("/api/providers/local-dub").json()["languages"]
    assert langs and all(l["download"]["bytes"] == 90_000_000 for l in langs)


def test_a_download_keeps_its_progress_and_measures_the_speed(data, monkeypatch):
    import io

    from app.services import model_sizes

    monkeypatch.setattr(model_sizes, "_bps", 0.0)
    out = io.BytesIO()
    model_sizes.copy(io.BytesIO(b"x" * (3 << 20)), out, "tiger")
    got = model_sizes.progress("tiger")
    assert got["done"] == 3 << 20 and got["total"] == 17_000_000
    model_sizes.finished("tiger")
    assert model_sizes.progress("tiger") is None and out.tell() == 3 << 20
