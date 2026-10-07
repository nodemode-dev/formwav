import json
import re
import shutil
import subprocess

import pytest

from app.services import render
from conftest import BACKEND, ROOT

FRONTEND = ROOT / "frontend"
FX_RS = ROOT / "native" / "formwav-dsp" / "src" / "fx.rs"
KINDS = sorted(render.FX_KINDS)


@pytest.fixture(scope="module")
def interface() -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    if not (FRONTEND / "public" / "core" / "formwav_dsp.wasm").is_file():
        pytest.skip("needs the audio core built for the browser: frontend/oc_install")
    done = subprocess.run([node, str(BACKEND / "tests" / "kinds_probe.mjs"), str(FRONTEND)], input=json.dumps([*render.FX_KINDS, "nonsense"]), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _core_kinds() -> dict[str, int]:
    found = re.findall(r"^pub const ([A-Z_]+): u8 = (\d+);", FX_RS.read_text(encoding="utf-8"), re.M)
    return {name.lower().replace("_", ""): int(code) for name, code in found}


def test_every_place_names_the_same_nineteen_kinds(interface):
    assert len(KINDS) == 19
    assert set(interface["kinds"]) == set(KINDS) == set(interface["catalogue"]) == set(_core_kinds())


@pytest.mark.parametrize("kind", KINDS)
def test_a_kind_has_one_code_in_the_browser_the_export_and_the_core(interface, kind):
    assert interface["kinds"][kind]["stage"][0] == render.FX_KINDS[kind] == _core_kinds()[kind]


@pytest.mark.parametrize("kind", KINDS)
def test_the_core_designs_every_value_the_document_keeps(interface, kind):
    assert interface["kinds"][kind]["designs"] == {"fallback": True, "low": True, "high": True}


@pytest.mark.parametrize("kind", KINDS)
def test_each_knob_in_the_catalogue_reaches_both_ends(interface, kind):
    assert [c for c in interface["kinds"][kind]["corners"] if not (c["kept"] and c["designs"])] == []


@pytest.mark.parametrize("kind", KINDS)
def test_the_export_reads_a_missing_value_as_the_document_holds_it(interface, kind):
    assert list(render._stage({"kind": kind})) == interface["kinds"][kind]["stage"]
