import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

import pytest

from conftest import BACKEND, FIXTURES, ROOT
from stand_ins import anthropic

DIST = ROOT / "frontend" / "dist"
SMALLEST = {"width": 1288, "height": 683}
WATCH = """
window.__fw = { errors: [], shift: 0, shifts: [], clicks: [] };
addEventListener('error', (e) => window.__fw.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => window.__fw.errors.push(String(e.reason)));
document.addEventListener('click', (e) => window.__fw.clicks.push(e.target), true);
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.hadRecentInput) continue;
    window.__fw.shift += e.value;
    window.__fw.shifts.push((e.sources || []).map((s) => (s.node ? s.node.className || s.node.nodeName : '?')));
  }
}).observe({ type: 'layout-shift', buffered: true });
"""
FIT = """(() => {
  const inView = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; };
  const transport = document.querySelector('.fw-transport');
  return {
    pageScroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
    transportOverflow: [transport.scrollWidth - transport.clientWidth, transport.scrollHeight - transport.clientHeight],
    metersInView: [inView('.fw-out-meter'), inView('.fw-phase-meter'), inView('.fw-lufs')],
  };
})()"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def model():
    server = anthropic.serve()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture(scope="module")
def app_url(model, tmp_path_factory):
    if not (DIST / "index.html").is_file():
        pytest.skip("needs the built interface: npm run build in frontend")
    home, data = tmp_path_factory.mktemp("home"), tmp_path_factory.mktemp("data")
    env = {**os.environ, "FORMWAV_DIST": str(DIST), "FORMWAV_DATA_DIR": str(data), "HOME": str(home), "USERPROFILE": str(home), "APPDATA": str(home / "AppData"), "ANTHROPIC_API_KEY": "stand-in", "ANTHROPIC_BASE_URL": model}
    port = _free_port()
    log = open(data / "engine.log", "wb")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 60
    while True:
        try:
            if urllib.request.urlopen(url + "/api/health", timeout=2).status == 200:
                break
        except OSError:
            pass
        if proc.poll() is not None or time.monotonic() > deadline:
            proc.kill()
            pytest.fail(f"the engine did not start; its log is {log.name}")
        time.sleep(0.2)
    yield url
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


@pytest.fixture(scope="module")
def browser():
    sync_api = pytest.importorskip("playwright.sync_api", reason="needs Playwright: pip install -r backend/tests/requirements.txt")
    with sync_api.sync_playwright() as p:
        try:
            chromium = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        except Exception as err:  # noqa: BLE001 - any launch failure means the browser is not installed here
            pytest.skip(f"needs Playwright's Chromium (python -m playwright install chromium): {str(err)[:200]}")
        yield chromium
        chromium.close()


@pytest.fixture
def page(browser, app_url):
    context = browser.new_context(viewport=SMALLEST)
    page = context.new_page()
    page.add_init_script(WATCH)
    page.console_errors = []
    page.on("console", lambda m: page.console_errors.append(m.text) if m.type == "error" and not m.text.startswith("Failed to load resource") else None)
    page.on("response", lambda r: page.console_errors.append(f"{r.status} {r.request.method} {r.url}") if r.status >= 400 and r.status != 503 else None)
    yield page
    context.close()


def _open(page, url: str) -> None:
    page.goto(url)
    page.wait_for_function("document.body.classList.contains('app-ready')")
    page.wait_for_function("document.querySelector('.fw-engine')?.dataset.state === 'ready'")


def _import_speech(page) -> None:
    page.set_input_files(".fw-file", str(FIXTURES / "jfk.wav"))
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 1")
    # the import ends with its notice, after the engine has looked for a tempo; a notice a test waits for after that
    # is not overwritten by it
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Imported')")


def _clean(page) -> dict:
    fw = page.evaluate("({ errors: window.__fw.errors, shift: window.__fw.shift, shifts: window.__fw.shifts })")
    return {"errors": fw["errors"] + page.console_errors, "shift": fw["shift"], "shifts": fw["shifts"]}


def test_the_app_boots_on_a_slow_machine_without_an_error_or_a_shift(page, app_url):
    page.context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": 4})
    _open(page, app_url)
    page.wait_for_timeout(1500)
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def test_the_window_fits_at_its_smallest_size(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    assert page.evaluate(FIT) == {"pageScroll": [0, 0], "transportOverflow": [0, 0], "metersInView": [True, True, True]}


def test_every_menu_item_reaches_one_control_and_the_view_menu_opens_each(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    proxies = page.evaluate("[...document.querySelectorAll('[role=menu] [data-proxy]')].map((b) => [b.textContent.trim(), document.querySelectorAll(b.dataset.proxy).length])")
    assert [p for p in proxies if p[1] != 1] == []
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 40, clip["y"] + clip["height"] * 0.75)
    view = page.locator('.fw-menu-pop[aria-label="View"] [data-proxy]')
    unreached = []
    for i in range(view.count()):
        page.locator(".fw-menu-btn", has_text="View").click()
        item = view.nth(i)
        target, seen = item.get_attribute("data-proxy"), page.evaluate("window.__fw.clicks.length")
        item.click()
        if not page.evaluate("([sel, from]) => window.__fw.clicks.slice(from).some((t) => t.closest && t.closest(sel))", [target, seen]):
            unreached.append(item.inner_text())
        page.keyboard.press("Escape")
    assert unreached == []
    assert _clean(page)["errors"] == []


def test_an_imported_file_becomes_a_track_that_plays(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    assert page.locator(".fw-lane").count() == 1
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Space")
    page.wait_for_function("document.querySelector('.fw-clock').textContent >= '00:00:00.500'")
    page.keyboard.press("Space")
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def test_history_lists_each_edit_and_goes_back_to_any_of_them(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.click('[data-agent-tab="history"]')
    rows = "[...document.querySelectorAll('.fw-history-row')].map((r) => [r.querySelector('.fw-history-label').textContent, r.dataset.state])"
    assert page.evaluate(rows) == [["Session start", "done"], ["Added jfk.wav", "now"]]
    page.click(".fw-history-row:nth-child(1) .fw-history-btn")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 0")
    assert page.evaluate(rows) == [["Session start", "now"], ["Added jfk.wav", "undone"]]
    page.click(".fw-history-row:nth-child(2) .fw-history-btn")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 1")
    assert _clean(page)["errors"] == []


def test_the_synth_tab_sets_the_sessions_synth_in_one_undo_step(page, app_url):
    _open(page, app_url)
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-dock-tab[data-panel="synth"]')
    page.click('.fw-wave-seg [data-wave="saw"]')
    page.wait_for_function("document.querySelector('.fw-wave-seg [data-wave=\"saw\"]').getAttribute('aria-pressed') === 'true'")
    page.select_option(".fw-synth-preset", "Warm bass")
    page.wait_for_function("document.querySelector('[data-synth-key=\"cutoff\"] .fw-knob-value').textContent === '600 Hz'")
    page.click('[data-agent-tab="history"]')
    labels = page.evaluate("[...document.querySelectorAll('.fw-history-label')].map((l) => l.textContent)")
    assert labels == ["Session start", "Changed the synth", "Changed the synth"]
    assert _clean(page)["errors"] == []


def _mixer_with_a_compressor(page, app_url) -> str:
    _open(page, app_url)
    _import_speech(page)
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 60, clip["y"] + clip["height"] * 0.75)
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-pane-media .fw-pane-tab[data-tab="effects"]')
    page.click('.fw-fxlib-item[data-proc="compressor"]')
    page.click('.fw-dock-tab[data-panel="mixer"]')
    return '.fw-strip[data-kind="track"]'


def test_the_mixers_controls_set_solo_safe_trim_polarity_automation_off_the_pan_law_and_a_bypass_by_kind(page, app_url):
    strip = _mixer_with_a_compressor(page, app_url)
    page.click(f"{strip} .fw-strip-solo", modifiers=["Alt"])
    page.click(f"{strip} .fw-strip-solo", modifiers=["ControlOrMeta"])
    page.click('[data-mix="clear-solos"]')
    assert [page.get_attribute(f"{strip} .fw-strip-solo", a) for a in ("aria-pressed", "data-safe")] == ["false", "true"]
    page.click(f"{strip} details.fw-strip-route > summary")
    page.focus(f"{strip} .fw-strip-trim")
    page.keyboard.press("ArrowRight")
    page.click(f"{strip} .fw-strip-invert")
    page.select_option(f"{strip} .fw-strip-auto", "off")
    assert page.locator(f"{strip} .fw-strip-fader").is_enabled()
    page.select_option(".fw-mix-panlaw", "-3")
    page.select_option(".fw-mix-bypass", "dynamics")
    assert page.input_value(".fw-mix-bypass") == ""
    page.click('[data-agent-tab="history"]')
    labels = page.evaluate("[...document.querySelectorAll('.fw-history-label')].map((l) => l.textContent)")
    assert labels[2:] == ["Changed the effects on jfk", "Soloed jfk", "Made jfk solo safe", "Cleared every solo", "Trimmed the input of jfk", "Inverted the polarity of jfk", "Turned off the automation of jfk", "Changed the pan law", "Bypassed inserts"]
    assert _clean(page)["errors"] == []


def test_while_it_plays_a_strip_holds_its_peak_and_latches_a_clip_and_a_dynamics_card_shows_its_reduction(page, app_url):
    strip = _mixer_with_a_compressor(page, app_url)
    page.focus(f"{strip} .fw-strip-fader")
    page.keyboard.press("End")
    page.click('.fw-tbtn[data-action="play"]')
    page.wait_for_function(f"document.querySelector('{strip} .fw-strip-clip').dataset.clip === 'true'")
    page.wait_for_function(f"[...document.querySelectorAll('{strip} .fw-out-hold')].every((h) => h.dataset.on === 'true')")
    page.click('.fw-dock-tab[data-panel="effects"]')
    page.wait_for_function("/^GR -\\d+\\.\\d dB$/.test(document.querySelector('.fw-fx-gr').textContent)")
    page.click('.fw-tbtn[data-action="stop"]')
    page.wait_for_function("document.querySelector('.fw-fx-gr').textContent === 'GR 0.0 dB'")
    page.click('.fw-dock-tab[data-panel="mixer"]')
    page.wait_for_function(f"[...document.querySelectorAll('{strip} .fw-out-hold')].every((h) => h.dataset.on === 'false')")
    page.click(f"{strip} .fw-strip-clip")
    assert page.get_attribute(f"{strip} .fw-strip-clip", "data-clip") == "false"
    assert _clean(page)["errors"] == []


def test_the_export_dialog_writes_a_range_as_24_bit_aiff_normalised_and_reports_its_true_peak(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.click('[data-action="export"]')
    dialog = "dialog.fw-export-dialog[open]"
    page.select_option(f'{dialog} [data-x="format"]', "aiff")
    assert page.locator(f'{dialog} [data-x="dither"]').is_enabled() and page.locator(f'{dialog} [data-x="from"]').is_disabled()
    page.select_option(f'{dialog} [data-x="range"]', "span")
    page.fill(f'{dialog} [data-x="from"]', "1")
    page.fill(f'{dialog} [data-x="to"]', "3")
    page.check(f'{dialog} [data-x="normalize"]')
    page.fill(f'{dialog} [data-x="normalize-db"]', "-1")
    with page.expect_download() as info:
        page.click(f'{dialog} button[value="export"]')
    data = open(info.value.path(), "rb").read()
    assert info.value.suggested_filename == "Untitled session.aiff" and data[8:12] == b"AIFF"
    i = data.index(b"COMM")
    channels, frames, bits = struct.unpack(">hIh", data[i + 8 : i + 16])
    assert (channels, frames, bits) == (2, 96000, 24)
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Exported')")
    notice = page.evaluate("document.querySelector('.fw-notice').textContent")
    assert "peak -1.0 dBFS" in notice and "dBTP" in notice and "normalized +" in notice
    assert _clean(page)["errors"] == []


def _labels(page) -> list:
    page.click('[data-agent-tab="history"]')
    return page.evaluate("[...document.querySelectorAll('.fw-history-label')].map((l) => l.textContent)")


def _range(page, a: float, b: float) -> None:
    """A Smart Tool range on the first clip from a to b seconds (100 px a second at the first zoom)."""
    body = page.locator(".fw-lane-body").first.bounding_box()
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    y = clip["y"] + clip["height"] * 0.42
    page.mouse.move(body["x"] + a * 100, y)
    page.mouse.down()
    page.mouse.move(body["x"] + (a + b) * 50, y)
    page.mouse.move(body["x"] + b * 100, y)
    page.mouse.up()


def test_the_edit_menu_and_its_keys_duplicate_repeat_shift_trim_and_cut_time_each_in_one_step(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 60, clip["y"] + clip["height"] * 0.75)
    page.keyboard.press("ControlOrMeta+d")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    page.locator(".fw-menu-btn", has_text="Edit").click()
    page.locator(".fw-edit-pop [role=menuitem]", has_text="Repeat").click()
    dialog = "dialog.fw-ask-dialog[open]"
    page.fill(f"{dialog} input[data-k=count]", "2")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 4")
    page.keyboard.press("Alt+h")
    page.wait_for_selector(dialog)
    page.fill(f"{dialog} input[data-k=by]", "0.5")
    page.click(f"{dialog} button[value=ok]")
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Shifted')")
    _range(page, 1, 2)
    page.locator(".fw-menu-btn", has_text="Edit").click()
    page.locator(".fw-edit-pop [role=menuitem]", has_text="Trim to selection").click()
    page.locator(".fw-menu-btn", has_text="Edit").click()
    page.locator(".fw-edit-pop [role=menuitem]", has_text="Cut time from every track").click()
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 3")
    assert _labels(page) == ["Session start", "Added jfk.wav", "Duplicated clips", "Repeated clips 2 times", "Shifted clips later", "Trimmed to the selection", "Cut time across the session"]
    assert _clean(page)["errors"] == []


def test_the_zoom_tool_a_preset_tab_the_big_counter_identify_beat_and_a_page_turn_hold_still(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    timeline = "parseFloat(document.querySelector('.fw-lanes').style.getPropertyValue('--fw-timeline-w'))"
    page.click('.fw-seg-btn[data-tool="zoom"]')
    body = page.locator(".fw-lane-body").first.bounding_box()
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    y = clip["y"] + clip["height"] / 2
    page.mouse.move(body["x"] + 200, y)
    page.mouse.down()
    page.mouse.move(body["x"] + 300, y)
    page.mouse.move(body["x"] + 400, y)
    page.mouse.up()
    # the 2 s dragged across fill the lanes in view, so the 11 s clip spans 5.5 views
    view = page.evaluate("document.querySelector('.fw-stage').clientWidth - document.querySelector('.fw-ruler-corner').offsetWidth - 24")
    assert abs(page.evaluate(timeline) - 5.5 * view) < 6
    page.keyboard.press("2")
    assert page.evaluate(timeline) == 1100
    page.click('.fw-seg-btn[data-tool="select"]')
    page.evaluate("document.querySelector('.fw-stage').scrollLeft = 0")
    _range(page, 0.1, 1.1)
    page.click('[data-mus="tempo"]')
    page.fill('.fw-mus-pop [data-m="bars"]', "1")
    page.click('.fw-mus-pop [data-m="identify"]')
    page.wait_for_function("document.querySelector('[data-mus-value=\"tempo\"]').textContent === '240'")
    page.keyboard.press("Escape")
    page.locator(".fw-menu-btn", has_text="View").click()
    page.locator(".fw-view-pop [role=menuitemcheckbox]", has_text="Big counter").click()
    stage = page.locator(".fw-stage").bounding_box()
    page.mouse.click(stage["x"] + 300, stage["y"] + stage["height"] - 30)
    page.keyboard.press("Tab")
    page.wait_for_function("document.querySelector('.fw-clock').textContent === '00:00:11.000'")
    assert page.evaluate("document.querySelector('.fw-big-counter-time').textContent") == "00:00:11.000"
    # AU-13: zoomed in (800 px a second) with the clip starting inside the view, Follow's page turns while playing move
    # nothing; the first comes 0.6 s after the click on Play, past the half second an input excuses
    page.evaluate("document.querySelector('.fw-stage').scrollLeft = 0")
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 60, clip["y"] + clip["height"] * 0.75)
    page.keyboard.press("Alt+h")
    page.wait_for_selector("dialog.fw-ask-dialog[open]")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=by]", "0.05")
    page.keyboard.press("Enter")
    page.keyboard.press("3")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Home")
    page.click('.fw-tbtn[data-action="play"]')
    page.wait_for_function("document.querySelector('.fw-stage').scrollLeft > 900")
    page.click('.fw-tbtn[data-action="stop"]')
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def _menu(page, menu: str, item: str) -> None:
    page.locator(".fw-menu-btn", has_text=menu).click()
    page.locator(f".fw-menu-pop[aria-label='{menu}'] [role^=menuitem]", has_text=item).first.click()
    # the menu closes after its item has run; a pointer pressed before then would land on the menu
    page.wait_for_selector(f".fw-menu-pop[aria-label='{menu}']", state="hidden")


def test_the_clip_and_track_menus_mute_lock_rename_nudge_fade_and_the_track_commands_each_in_one_step(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 60, clip["y"] + clip["height"] * 0.75)
    _menu(page, "Clip", "Mute or unmute")
    page.wait_for_selector(".fw-clip[data-mute='true']")
    _menu(page, "Clip", "Rename")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=name]", "Speech take")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelector('.fw-clip .fw-clip-name').textContent === 'Speech take'")
    left = "document.querySelector('.fw-lane .fw-clip').style.left"
    page.keyboard.press(".")
    page.wait_for_function(f"{left} === '10px'")
    page.keyboard.press(",")
    page.wait_for_function(f"{left} === '0px'")
    # a time-locked clip ignores a drag and says why
    _menu(page, "Clip", "Time lock")
    page.wait_for_selector(".fw-clip .fw-clip-lock:not([hidden])")
    page.mouse.move(clip["x"] + 80, clip["y"] + clip["height"] * 0.75)
    page.mouse.down()
    page.mouse.move(clip["x"] + 160, clip["y"] + clip["height"] * 0.75, steps=4)
    page.mouse.up()
    assert page.evaluate(left) == "0px"
    assert page.evaluate("document.querySelector('.fw-notice').textContent").startswith("This clip is time-locked")
    _menu(page, "Clip", "Time lock")
    # a range from inside the clip back past its start, then Cmd F: a one-second fade-in
    body = page.locator(".fw-lane-body").first.bounding_box()
    y = clip["y"] + clip["height"] * 0.42
    page.mouse.move(body["x"] + 100, y)
    page.mouse.down()
    page.mouse.move(body["x"] + 40, y)
    page.mouse.move(body["x"] - 30, y)
    page.mouse.up()
    page.keyboard.press("ControlOrMeta+f")
    page.wait_for_selector("dialog.fw-ask-dialog[open] select[data-k=shape]")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelector('.fw-notice').textContent === 'Created fades'")
    page.click(".fw-lane .fw-lane-name")
    _menu(page, "Track", "Duplicate")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 2")
    _menu(page, "Track", "Move down")
    page.wait_for_function("document.querySelector('.fw-lane .fw-lane-name').textContent === 'jfk copy'")
    _menu(page, "Track", "Large")
    page.wait_for_selector(".fw-lane[data-height='large']")
    _menu(page, "Track", "Hide")
    page.wait_for_function("[...document.querySelectorAll('.fw-lane')].filter((l) => l.hidden).length === 1")
    _menu(page, "Track", "Show hidden tracks")
    page.wait_for_function("[...document.querySelectorAll('.fw-lane')].filter((l) => l.hidden).length === 0")
    assert _labels(page) == [
        "Session start", "Added jfk.wav", "Muted clips", "Renamed a clip on jfk", "Nudged clips later", "Nudged clips earlier", "Time-locked clips", "Unlocked clips",
        "Created fades", "Duplicated jfk", "Moved jfk", "Changed the height of jfk", "Hid tracks", "Showed hidden tracks",
    ]
    assert _clean(page)["errors"] == []


def test_memory_locations_the_snap_dialog_and_a_range_pasted_on_another_track_hold_still(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.click("[data-add-track]")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 2")
    clock = "document.querySelector('.fw-clock').textContent"
    body = page.locator(".fw-lane-body").nth(1).bounding_box()
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Enter")
    page.mouse.click(body["x"] + 300, body["y"] + body["height"] / 2)
    page.wait_for_function(f"{clock} === '00:00:03.000'")
    page.keyboard.press("Enter")
    _menu(page, "Transport", "Memory locations")
    page.wait_for_function("document.querySelectorAll('.fw-labels-panel:not([hidden]) .fw-label-row').length === 2")
    row = page.locator(".fw-label-row").first
    row.locator(".fw-label-color").select_option("amber")
    row.locator(".fw-label-comment").fill("Opening")
    row.locator(".fw-label-comment").press("Enter")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Home")
    page.wait_for_function(f"{clock} === '00:00:00.000'")
    for key in ("NumpadDecimal", "Numpad2", "NumpadDecimal"):
        page.keyboard.press(key)
    page.wait_for_function(f"{clock} === '00:00:03.000'")
    page.click('[data-mus="snap"]')
    page.select_option('.fw-mus-pop select[data-m="grid"]', "1/16")
    page.keyboard.press("Escape")
    page.wait_for_function("document.querySelector('[data-mus-value=\"snap\"]').textContent === '1/16'")
    _range(page, 1, 2)
    page.keyboard.press("ControlOrMeta+c")
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Copied 1.000 s')")
    page.keyboard.press("Escape")
    page.mouse.click(body["x"] + 400, body["y"] + body["height"] / 2)
    page.keyboard.press("ControlOrMeta+v")
    page.wait_for_function("document.querySelectorAll('.fw-lane')[1].querySelectorAll('.fw-clip').length === 1")
    assert page.evaluate("document.querySelectorAll('.fw-lane')[1].querySelector('.fw-clip').style.left") == "400px"
    assert _labels(page) == ["Session start", "Added jfk.wav", "Added a track", "Added a marker", "Added a marker", "Changed a marker", "Changed a marker", "Changed snapping", "Pasted a range"]
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def test_the_counters_read_every_timebase_and_the_rulers_stack_with_nothing_moving_unasked(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    clock = "document.querySelector('.fw-clock').textContent"
    page.locator(".fw-ruler-canvas").first.click(position={"x": 300, "y": 10})
    page.wait_for_function(f"{clock} === '00:00:03.000'")
    page.click(".fw-clock")
    page.wait_for_selector(".fw-counter-pop:not([hidden])")
    readings = []
    for mode, rate in (("timecode", None), ("timecode", "25"), ("feet", None), ("samples", None), ("bars", None)):
        if rate:
            page.select_option('.fw-counter-pop [data-c="rate"]', rate)
        page.select_option('.fw-counter-pop [data-c="main"]', mode)
        readings.append(page.evaluate(clock))
    assert readings == ["00:00:03:00", "00:00:03:00", "4+11", "144000", "2| 3| 000"]
    page.select_option('.fw-counter-pop [data-c="main"]', "time")
    page.select_option('.fw-counter-pop [data-c="sub"]', "timecode")
    assert page.evaluate("[document.querySelector('.fw-subcounter').textContent, document.querySelector('.fw-st-length').hidden]") == ["Timecode 00:00:03:00", True]
    page.click('.fw-counter-pop [data-c="all"]')
    ruler = "Math.round(document.querySelector('.fw-ruler').getBoundingClientRect().height)"
    page.wait_for_function(f"{ruler} === 156")
    assert page.evaluate("[...document.querySelectorAll('.fw-ruler-names span')].map((s) => s.textContent)") == ["Bars|Beats", "Min:Secs", "Timecode", "Timecode 2", "Feet+Frames", "Samples"]
    page.click('.fw-counter-pop [data-c="minimal"]')
    page.wait_for_function(f"{ruler} === 36")
    page.keyboard.press("Escape")
    page.wait_for_selector(".fw-counter-pop", state="hidden")
    _range(page, 1, 2)
    cells = "[...document.querySelectorAll('.fw-sel-cell')].map((c) => getComputedStyle(c).display === 'none' ? null : c.querySelector('.fw-sel-value').textContent)"
    page.wait_for_function(f"{cells}[2] === '0:01.000'")
    # at the smallest window the tray holds Start and Length; End is dropped first
    assert page.evaluate(cells) == ["0:01.000", None, "0:01.000"]
    assert _labels(page) == ["Session start", "Added jfk.wav", "Changed the frame rate"]
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def test_consolidate_commit_and_make_inactive_each_in_one_step(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.locator(".fw-ruler-canvas").first.click(position={"x": 300, "y": 10})
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 40, clip["y"] + clip["height"] * 0.75)
    page.keyboard.press("s")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    first, second = [page.locator(".fw-lane .fw-clip").nth(i).bounding_box() for i in range(2)]
    page.mouse.click(first["x"] + 40, first["y"] + first["height"] * 0.75)
    page.keyboard.down("Shift")
    page.mouse.click(second["x"] + 40, second["y"] + second["height"] * 0.75)
    page.keyboard.up("Shift")
    _menu(page, "Edit", "Consolidate")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 1 && document.querySelector('.fw-notice').textContent.startsWith('Consolidated')")
    _menu(page, "Track", "Commit")
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Committed')")
    shown = "[...document.querySelectorAll('.fw-lane')].filter((l) => !l.hidden).map((l) => l.querySelector('.fw-lane-name').textContent)"
    assert page.evaluate(shown) == ["jfk.cm"]
    page.locator(".fw-lane:not([hidden]) .fw-lane-name").first.click()
    _menu(page, "Track", "Inactive")
    page.wait_for_function("document.querySelector('.fw-lane:not([hidden])').dataset.inactive !== undefined")
    assert _labels(page) == ["Session start", "Added jfk.wav", "Split a clip on jfk", "Consolidated clips", "Committed jfk", "Made tracks inactive"]
    assert _clean(page)["errors"] == []


def test_settings_agents_lists_six_clients_and_does_not_move_as_they_load(page, app_url):
    _open(page, app_url)
    page.locator(".fw-settings-menu .fw-menu-btn").click()
    page.locator('.fw-settings-pop [data-action="agents"]').click()
    dialog = page.locator(".fw-agents-dialog")
    before = dialog.bounding_box()
    page.wait_for_function("document.querySelectorAll('.fw-agents-dialog [data-client]').length === 6")
    assert dialog.bounding_box() == before
    assert _clean(page)["errors"] == []


def test_the_in_app_agent_carries_out_a_chain_of_tools(page, app_url):
    anthropic.REQUESTS.clear()
    _open(page, app_url)
    _import_speech(page)
    page.select_option(".fw-agent-via", "api")
    page.fill(".fw-agent-ask textarea", "Lower the track by 6 dB, fade its clip in and out, and mark one second")
    page.click('[data-agent="run"]')
    page.wait_for_function("document.querySelector('.fw-agent-log').textContent.includes('Done:')", timeout=60000)
    calls = anthropic.REQUESTS
    assert [c["path"] for c in calls] == ["/v1/messages"] * 3
    assert all(c["key"] == "stand-in" and len(c["tools"]) == 34 and "get_session" in c["tools"] and "run_command" in c["tools"] for c in calls)
    assert len(calls[2]["results"]) == 3 and not any(r.get("is_error") for r in calls[2]["results"])
    assert page.locator('[data-agent="undo"]').is_enabled()
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click(".fw-dock-more > .fw-menu-btn")
    page.click('.fw-dock-more [data-panel="labels"]')
    labels = page.evaluate("[...document.querySelectorAll('.fw-labels-list .fw-label-row')].map((r) => [r.querySelector('.fw-label-time').textContent, r.querySelector('.fw-label-text').value])")
    assert labels == [["00:01.000", "agent"]]
    assert _clean(page)["errors"] == []


def _engine(app_url: str, method: str, path: str, body=None, headers=None):
    import json

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(app_url + path, data=data, method=method, headers={"content-type": "application/json", "x-formwav-local": "1", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b"null")


def test_unsaved_work_is_offered_back_on_the_next_start_and_recovered_whole(page, app_url):
    req = urllib.request.Request(app_url + "/api/media", data=(FIXTURES / "jfk.wav").read_bytes(), method="POST", headers={"x-formwav-local": "1", "X-Filename": "jfk.wav"})
    import json

    ref = json.loads(urllib.request.urlopen(req, timeout=60).read())
    frames = int(ref["frames"])
    doc = {"sampleRate": ref["sampleRate"], "media": {ref["id"]: ref}, "markers": [], "tracks": [
        {"id": "t1", "name": "Kept take", "channels": ref["channels"], "gainDb": -2, "mute": False, "solo": False, "clips": [{"id": "c1", "mediaId": ref["id"], "start": 0, "length": frames // 2, "sourceIn": 0, "gainDb": 0}]},
        {"id": "t2", "name": "Second", "channels": ref["channels"], "gainDb": 0, "mute": False, "solo": False, "clips": [{"id": "c2", "mediaId": ref["id"], "start": frames // 2, "length": frames // 4, "sourceIn": 0, "gainDb": 0}]},
    ]}
    _engine(app_url, "PUT", "/api/autosave", {"name": "Lost interview", "document": doc})
    try:
        _open(page, app_url)
        page.wait_for_selector("dialog.fw-ask-dialog[open]")
        assert "Lost interview" in page.text_content("dialog.fw-ask-dialog .fw-ask-note") and "2 tracks, 2 clips" in page.text_content("dialog.fw-ask-dialog .fw-ask-note")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
        assert page.evaluate("[...document.querySelectorAll('.fw-lane .fw-lane-name')].map((n) => n.textContent)") == ["Kept take", "Second"]
        assert page.input_value("input.fw-session-name") == "Lost interview"
        assert page.evaluate("document.querySelector('.fw-notice').textContent").startswith("Recovered Lost interview")
        assert _clean(page)["errors"] == []
    finally:
        _engine(app_url, "DELETE", "/api/autosave")


def test_linked_faders_move_as_one_step_polarity_sits_on_the_strip_the_master_shows_lufs_media_folders_fold_and_selected_tracks_commit_together(page, app_url):
    import json

    req = urllib.request.Request(app_url + "/api/media", data=(FIXTURES / "jfk.wav").read_bytes(), method="POST", headers={"x-formwav-local": "1", "X-Filename": "jfk.wav"})
    ref = json.loads(urllib.request.urlopen(req, timeout=60).read())
    frames = int(ref["frames"])
    doc = {"sampleRate": ref["sampleRate"], "media": {ref["id"]: ref}, "markers": [], "tracks": [
        {"id": "t1", "name": "Host", "channels": ref["channels"], "gainDb": -2, "mute": False, "solo": False, "clips": [{"id": "c1", "mediaId": ref["id"], "start": 0, "length": frames // 2, "sourceIn": 0, "gainDb": 0}]},
        {"id": "t2", "name": "Guest", "channels": ref["channels"], "gainDb": 0, "mute": False, "solo": False, "clips": [{"id": "c2", "mediaId": ref["id"], "start": frames // 2, "length": frames // 4, "sourceIn": 0, "gainDb": 0}]},
        {"id": "t3", "name": "Room", "channels": ref["channels"], "gainDb": -6, "mute": False, "solo": False, "clips": []},
    ]}
    _engine(app_url, "PUT", "/api/autosave", {"name": "Mix", "document": doc})
    try:
        _open(page, app_url)
        page.wait_for_selector("dialog.fw-ask-dialog[open]")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    finally:
        _engine(app_url, "DELETE", "/api/autosave")
    page.click('[data-agent-tab="history"]')
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-dock-tab[data-panel="mixer"]')
    host, guest, room = ('.fw-strip[data-key="t1"]', '.fw-strip[data-key="t2"]', '.fw-strip[data-key="t3"]')
    page.click(f"{host} .fw-strip-name", modifiers=["ControlOrMeta"])
    page.click(f"{guest} .fw-strip-name", modifiers=["ControlOrMeta"])
    assert page.evaluate("[...document.querySelectorAll('.fw-strip[data-linked]')].map((s) => s.dataset.key)") == ["t1", "t2"]
    page.focus(f"{host} .fw-strip-fader")
    page.keyboard.press("PageDown")
    _step(page, "Moved 2 faders together")
    values = [float(page.input_value(f"{s} .fw-strip-fader")) for s in (host, guest, room)]
    delta = values[0] + 2
    assert delta < 0 and abs(values[1] - delta) < 0.051 and values[2] == -6
    page.click(f"{guest} .fw-strip-phase")
    _step(page, "Inverted the polarity of Guest")
    assert page.get_attribute(f"{guest} .fw-strip-phase", "aria-pressed") == "true"
    for s in (host, guest, room):
        box = page.locator(f"{s} .fw-strip-phase").bounding_box()
        strip = page.locator(s).bounding_box()
        assert box and box["width"] > 0 and box["x"] + box["width"] <= strip["x"] + strip["width"]
    master = '.fw-strip[data-kind="master"] .fw-strip-lufs'
    assert page.locator(master).is_visible() and page.text_content(master).endswith("LUFS I")
    page.click(".fw-pane-media .fw-media-item", button="right")
    page.wait_for_selector("dialog.fw-ask-dialog[open]")
    page.fill('dialog.fw-ask-dialog [data-k="folder"]', "Dialogue")
    page.keyboard.press("Enter")
    page.wait_for_selector('.fw-media-folder[data-folder="Dialogue"]')
    assert page.text_content('.fw-media-folder[data-folder="Dialogue"] .fw-media-folder-count') == "1"
    page.click('.fw-media-folder[data-folder="Dialogue"]')
    assert page.get_attribute('.fw-media-folder[data-folder="Dialogue"]', "aria-expanded") == "false" and page.locator(".fw-pane-media .fw-media-item").count() == 0
    page.click('.fw-media-folder[data-folder="Dialogue"]')
    page.locator('.fw-lane .fw-clip').nth(0).click()
    page.locator('.fw-lane .fw-clip').nth(1).click(modifiers=["Shift"])
    _menu(page, "Track", "Commit selected tracks")
    page.wait_for_function("[...document.querySelectorAll('.fw-history-label')].some((l) => l.textContent === 'Committed 2 tracks')", timeout=60000)
    shown = "[...document.querySelectorAll('.fw-lane .fw-lane-name')].filter((n) => n.offsetParent !== null).map((n) => n.textContent)"
    assert page.evaluate(shown) == ["Host.cm", "Guest.cm", "Room"]
    page.evaluate("document.activeElement?.blur()")
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function(f"{shown}.join() === 'Host,Guest,Room'")
    assert _clean(page)["errors"] == []


ROWS ="[...document.querySelectorAll('.fw-piano-list tbody tr')].map((r) => [...r.querySelectorAll('input')].map((i) => i.value))"
NOTES_STATE = "document.querySelector('.fw-piano .fw-piano-state').textContent"


def _at(page, frame: int, pitch: int) -> tuple:
    """The page point of a session frame and a pitch on the note editor's grid, from the geometry its canvas carries."""
    box = page.locator(".fw-piano-canvas").bounding_box()
    d = page.evaluate("({ ...document.querySelector('.fw-piano-canvas').dataset })")
    x = box["x"] + float(d["keyW"]) + (frame - float(d["origin"])) * float(d["pxPerFrame"]) + 1
    y = box["y"] + (int(d["low"]) + int(d["rows"]) - 1 - pitch + 0.5) * float(d["rowH"])
    return x, y


def _add_notes(page, notes: list) -> None:
    for k, (frame, pitch) in enumerate(notes, start=1):
        page.mouse.click(*_at(page, frame, pitch))
        page.wait_for_function(f"{NOTES_STATE} === 'Notes · {k} notes'")


def _new_note_clip(page) -> None:
    # History open beside the work, so each step's words can be waited for as they land
    page.click('[data-agent-tab="history"]')
    _menu(page, "Event", "New note clip")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 1 && !document.querySelector('.fw-piano').hidden")
    page.wait_for_function(f"{NOTES_STATE} === 'Notes · 0 notes'")


def _step(page, label: str) -> None:
    page.wait_for_function("(label) => [...document.querySelectorAll('.fw-history-label')].some((l) => l.textContent === label)", arg=label)


def test_a_new_note_clip_takes_clicked_notes_a_band_selection_and_arrow_runs_as_single_steps(page, app_url):
    _open(page, app_url)
    _new_note_clip(page)
    # a quarter note is 24000 samples at 120 BPM and 48 kHz
    _add_notes(page, [(0, 60), (24000, 64), (48000, 67)])
    # a drag across empty grid selects the notes it covers, and adds none
    x0, y0 = _at(page, 18000, 70)
    x1, y1 = _at(page, 60000, 63)
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=6)
    page.mouse.up()
    for key in ("ArrowUp", "ArrowUp", "ArrowUp"):
        page.keyboard.press(key)
    _step(page, "Transposed notes")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    _step(page, "Moved notes")
    page.click(".fw-piano-head [data-list]")
    page.wait_for_function(f"{ROWS}.length === 3")
    # each new note is a 1/16 (240 ticks); the two selected went up three semitones and right two 1/16s
    assert page.evaluate(ROWS) == [["1| 1| 000", "C4", "240", "100"], ["1| 2| 480", "G4", "240", "100"], ["1| 3| 480", "A#4", "240", "100"]]
    page.click(".fw-piano-head [data-list]")
    page.focus(".fw-piano-canvas")
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.press("Delete")
    page.wait_for_function(f"{NOTES_STATE} === 'Notes · 0 notes'")
    assert page.locator(".fw-lane .fw-clip").count() == 1
    assert _labels(page) == ["Session start", "New note clip", "Edited notes on Notes", "Edited notes on Notes", "Edited notes on Notes", "Transposed notes", "Moved notes", "Deleted notes"]
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


def test_the_event_menu_and_list_quantize_edit_name_chords_and_split_each_in_one_step(page, app_url):
    _open(page, app_url)
    _new_note_clip(page)
    page.select_option(".fw-piano-head [data-snap]", "")
    _add_notes(page, [(1500, 60), (1500, 64), (1500, 67)])
    # a note just added is the one selected, and an operation takes the selection
    _menu(page, "Event", "Select all notes")
    _menu(page, "Event", "Quantize")
    page.wait_for_selector("dialog.fw-ask-dialog[open] select[data-k=grid]")
    page.keyboard.press("Enter")
    _step(page, "Quantized 3 notes")
    _menu(page, "Event", "Event list")
    page.wait_for_function(f"{ROWS}.length === 3")
    # snap off, a new note is an eighth (480 ticks)
    assert page.evaluate(ROWS) == [["1| 1| 000", "C4", "480", "100"], ["1| 1| 000", "E4", "480", "100"], ["1| 1| 000", "G4", "480", "100"]]
    rows = page.locator(".fw-piano-list tbody tr")
    rows.nth(1).locator("[data-f=velocity]").fill("80")
    rows.nth(1).locator("[data-f=velocity]").press("Tab")
    _step(page, "Changed a note's velocity")
    rows.nth(2).locator("[data-f=pitch]").fill("A4")
    rows.nth(2).locator("[data-f=pitch]").press("Tab")
    _step(page, "Changed a note's pitch")
    rows.nth(0).locator("[data-f=start]").fill("1| 2| 000")
    rows.nth(0).locator("[data-f=start]").press("Tab")
    _step(page, "Moved a note")
    page.wait_for_function(f"{ROWS}[2][1] === 'C4'")
    assert page.evaluate(ROWS) == [["1| 1| 000", "E4", "480", "80"], ["1| 1| 000", "A4", "480", "100"], ["1| 2| 000", "C4", "480", "100"]]
    _menu(page, "Event", "Select all notes")
    _menu(page, "Event", "Change velocity")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=a]", "90")
    page.keyboard.press("Enter")
    _step(page, "Changed the velocity of 3 notes")
    _menu(page, "Event", "Change duration")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=a]", "1920")
    page.keyboard.press("Enter")
    _step(page, "Changed the duration of 3 notes")
    assert page.evaluate(ROWS) == [["1| 1| 000", "E4", "1920", "90"], ["1| 1| 000", "A4", "1920", "90"], ["1| 2| 000", "C4", "1920", "90"]]
    # A, C and E over a C in the bass
    _menu(page, "Event", "Name chords")
    page.wait_for_function("document.querySelector('.fw-notice').textContent === 'Named 1 chord: Am/C'")
    _menu(page, "Event", "Split notes")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=low]", "A4")
    page.fill("dialog.fw-ask-dialog[open] input[data-k=high]", "B4")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 2")
    _step(page, "Split 1 note to a new track")
    assert [r[1] for r in page.evaluate(ROWS)] == ["E4", "C4"]
    assert page.evaluate("[...document.querySelectorAll('.fw-lane .fw-lane-name')].map((n) => n.textContent)") == ["Notes", "Notes split"]
    assert _labels(page) == [
        "Session start", "New note clip", "Edited notes on Notes", "Edited notes on Notes", "Edited notes on Notes", "Quantized 3 notes", "Changed a note's velocity",
        "Changed a note's pitch", "Moved a note", "Changed the velocity of 3 notes", "Changed the duration of 3 notes", "Named 1 chord as markers", "Split 1 note to a new track",
    ]
    # the Inspector's MIDI effects offer the real-time duration and delay
    clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
    page.mouse.click(clip["x"] + 20, clip["y"] + clip["height"] * 0.75)
    page.click(".fw-dock-more > .fw-menu-btn")
    page.click('.fw-dock-more [data-panel="inspector"]')
    for kind in ("duration", "delay"):
        page.select_option('[data-midifx="kind"]', kind)
        page.click('[data-midifx="add"]')
    page.wait_for_function("[...document.querySelectorAll('[data-midifx-list] .fw-sam-opt span')].map((s) => s.textContent).join() === 'Percent,Milliseconds'")
    page.fill('[data-midifx-list] [data-mfx-p="ms"]', "250")
    page.press('[data-midifx-list] [data-mfx-p="ms"]', "Tab")
    page.wait_for_function("document.querySelector('[data-midifx-list] [data-mfx-p=\"ms\"]')?.value === '250' && document.querySelector('.fw-notice').textContent.startsWith('MIDI effects applied')")
    assert _labels(page).count("Changed the MIDI effects on Notes") == 3
    assert _clean(page) == {"errors": [], "shift": 0, "shifts": []}


CUT = """(() => {
  const out = [];
  const controls = 'button, [role=tab], [role=menuitem], [role=menuitemradio], label, select, input, .fw-cf-label, .fw-knob-label, .fw-knob-value, .fw-dock-track, .fw-dock-detail';
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (n.parentElement?.tagName === 'DETAILS' && !n.parentElement.open && n.tagName !== 'SUMMARY') return false;
    }
    return true;
  };
  const say = (el) => (el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.tagName === 'INPUT' ? el.value || el.placeholder : el.textContent.trim()).slice(0, 50);
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') || el.closest('.fw-vh') || !shown(el)) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    const control = /^(INPUT|SELECT|BUTTON)$/.test(el.tagName);
    if (!texts.length && !control) continue;
    const cs = getComputedStyle(el);
    if (el.tagName !== 'TEXTAREA' && !(el.tagName === 'INPUT' && el.type === 'number') && el.scrollWidth > el.clientWidth + 1 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis')) out.push(['clipped', say(el)]);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (el.tagName === 'SELECT' && el.options[el.selectedIndex] && c.measureText(el.options[el.selectedIndex].text).width > room - 15) out.push(['select cut', say(el)]);
    if (el.tagName === 'INPUT' && !el.value && el.placeholder && c.measureText(el.placeholder).width > room + 1) out.push(['placeholder cut', el.placeholder]);
    if (el.closest(controls)) {
      for (const t of texts) {
        const range = document.createRange();
        range.selectNodeContents(t);
        if (new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size > 1) out.push(['wrapped', t.textContent.trim().slice(0, 50)]);
      }
    }
    const r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const cx = acs.overflowX !== 'visible', cy = acs.overflowY !== 'visible';
      if (!cx && !cy) continue;
      const scrolls = /auto|scroll/.test(`${cx ? acs.overflowX : ''} ${cy ? acs.overflowY : ''}`);
      const ar = a.getBoundingClientRect();
      const left = ar.left + a.clientLeft, top = ar.top + a.clientTop, right = left + a.clientWidth, bottom = top + a.clientHeight;
      const outside = r.right <= left || r.left >= right || r.bottom <= top || r.top >= bottom;
      if (outside) {
        if (!scrolls && !(acs.display.includes('flex') && acs.flexWrap === 'wrap')) out.push(['hidden', say(el)]);
        break;
      }
      const sideways = cx && (r.left < left - 1 || r.right > right + 1);
      const below = cy && (r.top < top - 1 || r.bottom > bottom + 1);
      if (!scrolls && (sideways || below)) { out.push(['cut', say(el)]); break; }
      if (scrolls && sideways && !el.closest('.fw-stage')) { out.push(['cut sideways', say(el)]); break; }
      if (sideways || below) break;
    }
  }
  return out;
})()"""
ACTIONS_IN_VIEW = """(() => {
  const panel = document.querySelector('.fw-dock .fw-cliptab').getBoundingClientRect();
  return [...document.querySelectorAll('.fw-dock .fw-cf-actions button')].filter((b) => { const r = b.getBoundingClientRect(); return r.top < panel.top || r.bottom > panel.bottom; }).map((b) => b.textContent);
})()"""
STATES = [
    ["clip"], ["effects"], ["studio", "effects"], ["mixer"], ["mixer", "route"], ["synth"], ["pads"], ["spectrum"], ["transcript"],
    ["more", "inspector"], ["more", "notes"], ["list"], ["more", "labels"],
]


@pytest.mark.parametrize("size", [(1280, 674), (1440, 900), (1710, 940)], ids=["1280", "1440", "1710"])
def test_no_label_or_control_is_clipped_wrapped_cut_or_hidden_at_three_sizes(browser, app_url, size):
    context = browser.new_context(viewport={"width": size[0], "height": size[1]})
    page = context.new_page()
    try:
        _open(page, app_url)
        _import_speech(page)
        clip = page.locator(".fw-lane .fw-clip").first.bounding_box()
        page.mouse.click(clip["x"] + 60, clip["y"] + clip["height"] * 0.75)
        if page.locator(".fw-dock").is_hidden():
            page.click('.fw-panel-toggle[data-pane="editor"]')
        found = {}
        for state in STATES:
            for step in state:
                if step == "more":
                    page.click(".fw-dock-more > .fw-menu-btn")
                elif step == "route":
                    page.click("details.fw-strip-route > summary")
                elif step == "list":
                    page.click(".fw-piano-head [data-list]")
                elif step == "studio":
                    # two processors from the library on the clip's track: the largest card (22 controls) and a small one
                    page.click('.fw-pane-media .fw-pane-tab[data-tab="effects"]')
                    page.click('.fw-fxlib-item[data-proc="channel_strip"]')
                    page.click('.fw-fxlib-item[data-proc="dither"]')
                elif state[0] == "more":
                    page.click(f'.fw-dock-more [data-panel="{step}"]')
                else:
                    page.click(f'.fw-dock-tab[data-panel="{step}"]')
                page.wait_for_timeout(250)
            found[" ".join(state)] = page.evaluate(CUT)
            if state == ["clip"]:
                found["clip actions in view"] = page.evaluate(ACTIONS_IN_VIEW)
        for tab in ("effects", "sounds", "media"):
            page.click(f'.fw-pane-media .fw-pane-tab[data-tab="{tab}"]')
            page.wait_for_timeout(250)
            found[f"browser {tab}"] = page.evaluate(CUT)
        page.click('[data-agent-tab="history"]')
        page.wait_for_timeout(250)
        found["history"] = page.evaluate(CUT)
        page.locator(".fw-menu-btn", has_text="Event").click()
        page.wait_for_timeout(250)
        found["event menu"] = page.evaluate(CUT)
        page.keyboard.press("Escape")
        assert {k: v for k, v in found.items() if v} == {}
    finally:
        context.close()
