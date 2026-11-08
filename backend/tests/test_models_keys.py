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
    monkeypatch.setattr(secrets, "_store", lambda: None)
    yield tmp_path
    secrets._held.clear()


def test_a_key_is_kept_in_a_file_only_the_user_reads_and_never_comes_back(client, data):
    got = client.put("/api/keys/FAL_KEY", json={"value": KEY}, headers=H)
    assert got.status_code == 200
    assert got.json() == {"kept": "file", "set": True, "source": "file", "last4": KEY[-4:]}
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
    assert got["kept"] == "store" and got["last4"] == KEY[-4:]
    assert store.items == {("formwav", "ELEVENLABS_API_KEY"): KEY}
    assert not (data / "data" / "keys-file.json").exists()
    assert KEY not in (data / "data" / "keys.json").read_text()
    secrets._held.clear()
    assert secrets.get("ELEVENLABS_API_KEY") == KEY
    client.delete("/api/keys/ELEVENLABS_API_KEY", headers=H)
    assert store.items == {} and secrets.get("ELEVENLABS_API_KEY") == ""


def test_the_environment_still_answers_and_a_saved_key_wins(client, data, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-the-env-file")
    listed = {k["name"]: k for k in client.get("/api/keys").json()["keys"]}
    assert listed["ANTHROPIC_API_KEY"]["source"] == "environment"
    assert secrets.get("ANTHROPIC_API_KEY") == "from-the-env-file"
    client.put("/api/keys/ANTHROPIC_API_KEY", json={"value": KEY}, headers=H)
    assert secrets.get("ANTHROPIC_API_KEY") == KEY
    client.delete("/api/keys/ANTHROPIC_API_KEY", headers=H)
    assert secrets.get("ANTHROPIC_API_KEY") == "from-the-env-file"


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
