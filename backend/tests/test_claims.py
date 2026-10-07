"""The README's countable claims held to the code (PLAN_v12 C3; the sidecar's claims audit, now in the suite so CI keeps
it): each number the README states outside its Status history is read from the README and compared with the truth
computed from the source or the engine itself, so a count cannot go stale silently."""

import json
import re

import pytest

from conftest import ROOT

WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
NUMBER = r"(\d+|" + "|".join(WORDS) + ")"


def _num(s: str) -> int:
    s = s.lower()
    if s.isdigit():
        return int(s)
    if "-" in s:
        tens, _, unit = s.partition("-")
        return TENS[tens] + WORDS[unit] if tens in TENS and unit in WORDS else -1
    return TENS.get(s, WORDS.get(s, -1))


def _readme() -> str:
    full = (ROOT / "README.md").read_text(encoding="utf-8")
    return full[: full.index("## Status")] + full[full.index("## Contributors") :]


def _stated(pattern: str) -> list[int]:
    return [_num(m.group(1)) for m in re.finditer(pattern, _readme(), re.I)]


def _live_kinds() -> int:
    doc = (ROOT / "frontend/src/engine/document.ts").read_text(encoding="utf-8")
    # the processor kind holds the library's processors, counted on their own below
    return len([k for k in re.findall(r'"([a-z]+)"', re.search(r"const FX_KINDS: ReadonlySet<string> = new Set\(\[([^\]]*)\]", doc).group(1)) if k != "processor"])


def _studio_processors() -> int:
    from app.services import media

    return len(json.loads(media._require_core().processors()))


def _mcp_tools() -> int:
    return len(re.findall(r"^\s*@mcp\.tool", (ROOT / "backend/formwav_mcp/server.py").read_text(encoding="utf-8"), re.M))


def _themes() -> int:
    return len(re.findall(r"^\s+'[a-z0-9-]+': \{ label:", (ROOT / "frontend/src/vendor/formvis/themes.ts").read_text(encoding="utf-8"), re.M))


def _undo_depth() -> int:
    return int(re.search(r"HISTORY_LIMIT = (\d+)", (ROOT / "frontend/src/engine/index.ts").read_text(encoding="utf-8")).group(1))


def _export_formats() -> int:
    exp = (ROOT / "backend/app/services/export.py").read_text(encoding="utf-8")
    block = exp[exp.index("FORMATS: dict") : exp.index("\n}", exp.index("FORMATS: dict"))]
    return len(re.findall(r'^\s+"([a-z0-9]+)":', block, re.M))


CLAIMS = [
    ("live effect kinds", r"\b" + NUMBER + r" (?:realtime effects|effect kinds)", _live_kinds),
    ("studio processors", r"\b" + NUMBER + r" studio processors", _studio_processors),
    ("MCP tools", r"\b([\w-]+) `formwav_\*` tools", _mcp_tools),
    ("theme profiles", r"\b(\d+) theme(?: profile|s)", _themes),
    ("undo depth", r"\b(\d+) deep", _undo_depth),
    ("export formats", r"\bin (?:any of )?" + NUMBER + r" formats", _export_formats),
]


@pytest.mark.parametrize(("name", "pattern", "truth"), CLAIMS, ids=[c[0] for c in CLAIMS])
def test_each_count_the_readme_states_matches_the_code(name, pattern, truth):
    assert all(n == truth() for n in _stated(pattern)), f"{name}: README says {_stated(pattern)}, the code has {truth()}"


def test_the_catalogue_count_matches_the_engines_own_effects(client):
    groups = client.get("/api/effects").json()
    own = sum(len(g["effects"]) for g in groups if g["group"] != "Plugins")
    said = _stated(r"\b(\d+) catalogue effects")
    assert all(n == own for n in said), f"README says {said}, the engine lists {own}"


def test_the_opening_names_the_version_being_released():
    version = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))["version"]
    m = re.search(r"At v(\S+) it is", _readme())
    assert m and m.group(1) == version


def test_the_loopback_sentence_admits_the_devices_listener():
    if not (ROOT / "backend/app/routers/remote.py").exists():
        return
    m = re.search(r"nothing listens on the network unless ([^.]*)\.", _readme())
    assert m and "Devices" in m.group(1)


def test_a_memory_figure_for_long_files_is_right_where_one_is_given():
    m = re.search(r"about (\d+) MB for 30 minutes", _readme())
    if m:
        truth = round(30 * 60 * 48000 * 2 * 4 / 1e6)
        assert abs(int(m.group(1)) - truth) <= truth * 0.02
