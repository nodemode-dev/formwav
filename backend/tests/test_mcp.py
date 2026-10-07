import json
import os
import subprocess
from pathlib import Path

import pytest

from conftest import BACKEND, FIXTURES

MCP_PYTHON = BACKEND / "formwav_mcp" / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
CHECKS = [
    "lists its tools", "formwav_status", "formwav_local_models_status", "formwav_list_voices kokoro", "formwav_list_voices elevenlabs without a key",
    "formwav_generate_speech kokoro", "formwav_generate_music elevenlabs not set up", "formwav_generate_music acestep not set up",
    "formwav_generate_sound_effect without a key", "formwav_import_audio", "formwav_speech_regions", "formwav_transcribe_media",
    "formwav_transcribe_with_speakers without a key", "formwav_regenerate_words pocket", "formwav_dub_media local es",
    "formwav_separate_speech_music_ambience", "formwav_analyze_media", "formwav_list_media", "formwav_list_effects", "formwav_apply_effect",
    "formwav_debleed", "formwav_debleed refuses the recording as its own reference", "formwav_export_media", "formwav_list_inputs", "formwav_record", "formwav_cloud_status",
    "formwav_cloud_list_files not connected", "formwav_cloud_import not connected", "formwav_cloud_save not connected",
    "formwav_list_sessions", "formwav_get_session", "formwav_render_session mix", "formwav_render_session surround51", "formwav_render_session adm",
]


@pytest.fixture(scope="module")
def probe(engine_url, tmp_path_factory):
    if not MCP_PYTHON.exists():
        pytest.skip("needs the MCP server's venv (backend/oc_install makes it)")
    out = tmp_path_factory.mktemp("mcp")
    done = subprocess.run([str(MCP_PYTHON), str(Path(__file__).with_name("mcp_probe.py")), engine_url, str(FIXTURES / "jfk.wav"), str(BACKEND), str(out)], capture_output=True, text=True, timeout=1800)
    assert done.returncode == 0 and done.stdout.strip(), done.stderr[-1500:]
    return json.loads(done.stdout.strip().splitlines()[-1]), out


@pytest.mark.parametrize("check", CHECKS)
def test_each_tool_works_or_says_what_is_missing(probe, check):
    results, _ = probe
    assert check in results, f"the probe never ran {check}"
    if results[check].get("skip"):
        pytest.skip(results[check]["skip"])
    assert results[check]["ok"], results[check]["detail"]


def test_the_probe_ran_nothing_this_list_does_not_know(probe):
    results, _ = probe
    assert sorted(set(results) - set(CHECKS)) == []


def test_the_adm_rendered_through_the_mcp_server_plays_in_the_ebu_renderer(probe, tmp_path):
    import test_adm

    _, out = probe
    y = test_adm._render(tmp_path, (out / "render_adm.wav").read_bytes())
    assert test_adm._shares(y, 500, 0.0, 0.3)["M+030"] > 95 and test_adm._shares(y, 500, 2.2, 2.9)["M-030"] > 99
    assert test_adm._shares(y, 700)["M+000"] > 99
