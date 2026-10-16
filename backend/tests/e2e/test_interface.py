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
    # an earlier test's autosave (kept every 30 s while a session has unsaved changes) would greet this one with Recover
    urllib.request.urlopen(urllib.request.Request(app_url + "/api/autosave", method="DELETE", headers={"x-formwav-local": "1"}), timeout=10).close()
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
    page.locator(".fw-edit-pop [role=menuitem]", has_text="Repeat...").click()
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
    page.wait_for_function(f"{ruler} === 236")
    assert page.evaluate("[...document.querySelectorAll('.fw-ruler-names span')].map((s) => s.textContent)") == ["Bars|Beats", "Min:Secs", "Timecode", "Timecode 2", "Feet+Frames", "Samples", "Tempo", "Meter", "Key", "Chords"]
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
    assert all(c["key"] == "stand-in" and len(c["tools"]) == 37 and "get_session" in c["tools"] and "apply_document_commands" in c["tools"] and "run_command" in c["tools"] for c in calls)
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


def test_the_models_section_says_where_the_chosen_model_runs_and_lists_every_models_source_and_licences(page, app_url):
    _open(page, app_url)
    page.click('.fw-pane-media .fw-pane-tab[data-tab="sounds"]')
    page.click(".fw-models > h3")
    page.wait_for_selector(".fw-models-origin:not([hidden])")
    line = page.text_content(".fw-models-origin-text")
    assert "runs on" in line and "Code" in line and "weights" in line
    assert page.get_attribute(".fw-models-origin-link", "href").startswith("https://")
    page.select_option(".fw-models-kind", "ld-install")
    assert page.text_content(".fw-models-origin-text").startswith("Dubbing: Whisper, Argos Translate, Kokoro: runs on this machine; nothing leaves it.")
    page.click(".fw-models-sources > summary")
    items = page.evaluate("[...document.querySelectorAll('.fw-models-sources-list li')].map((li) => li.textContent)")
    assert len(items) >= 14 and any(i.startswith("ElevenLabs") and "uploaded" in i for i in items) and any(i.startswith("Chatterbox") and "watermark" in i for i in items)
    box = page.locator(".fw-models-sources").bounding_box()
    assert box["width"] > 0 and page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert _clean(page)["errors"] == []


LANGUAGES = ["es", "es-MX", "pt-BR", "fr", "fr-CA", "de", "it", "nl", "da", "fi", "nb", "sv", "ru", "pl", "cs", "hu", "uk", "tr", "zh-CN", "zh-TW", "ja", "ko", "id", "th", "vi"]


def test_every_string_on_screen_has_a_translation_in_all_twenty_five_languages_and_english_comes_back_whole(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.click('.fw-pane-media .fw-pane-tab[data-tab="sounds"]')
    page.wait_for_timeout(2500)
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-dock-tab[data-panel="mixer"]')
    page.click('[data-mix="add-bus"]')
    page.click('[data-mix="add-vca"]')
    page.click(".fw-lane .fw-auto-toggle")
    page.click('[data-agent-tab="history"]')
    english = page.evaluate("window.__fwI18n.keys()")
    text = page.evaluate("document.body.innerText")
    gaps = {}
    for code in LANGUAGES:
        page.evaluate("(c) => window.__fwI18n.setLanguage(c)", code)
        missing = page.evaluate("window.__fwI18n.missing()")
        if missing:
            gaps[code] = missing[:5] + ([f"... {len(missing)} in all"] if len(missing) > 5 else [])
        fits = page.evaluate("""(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const tabs = [...document.querySelectorAll('.fw-menu-btn, .fw-dock-tab, .fw-agent-tab, .fw-pane-tab')].filter((e) => e.offsetParent);
          return r('.fw-session-name').right <= r('.fw-topbar-actions').left && document.documentElement.scrollWidth <= innerWidth && tabs.every((e) => e.scrollWidth <= e.clientWidth + 1);
        })()""")
        if not fits:
            gaps[f"{code} layout"] = "a header label overlaps or is cut"
    assert gaps == {}
    page.evaluate("window.__fwI18n.setLanguage('de')")
    assert page.text_content(".fw-menu-btn") != "File" and page.evaluate("document.documentElement.lang") == "de"
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight")
    page.evaluate("window.__fwI18n.setLanguage('en')")
    assert page.evaluate("window.__fwI18n.keys()") == english and page.evaluate("document.body.innerText") == text
    assert _clean(page)["errors"] == []


def test_a_chosen_language_holds_after_a_reload_and_shows_from_the_first_frame(page, app_url):
    _open(page, app_url)
    page.click(".fw-menu-btn:has-text('Settings')")
    page.select_option(".fw-lang-pick select", "ja")
    page.keyboard.press("Escape")
    page.wait_for_function("document.documentElement.lang === 'ja'")
    assert page.evaluate("document.querySelector('.fw-menu-btn').textContent") != "File"
    page.context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": 4})
    page.reload()
    page.wait_for_function("document.body.classList.contains('app-ready')")
    first = page.evaluate("[...document.querySelectorAll('.fw-menu-btn')].map((b) => b.textContent)")
    assert "File" not in first and "Settings" not in first and page.evaluate("document.documentElement.lang") == "ja"
    page.wait_for_timeout(1500)
    assert _clean(page)["shift"] == 0
    page.evaluate("window.__fwI18n.setLanguage('en')")
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
    _engine(app_url, "DELETE", "/api/autosave")
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


def test_a_midi_file_becomes_named_note_tracks_that_export_as_midi_and_musicxml_score_and_step_input_adds_notes(page, app_url, tmp_path):
    import mido
    import music21

    from test_smf import song_bytes

    song = tmp_path / "song.mid"
    song.write_bytes(song_bytes())
    _open(page, app_url)
    page.set_input_files(".fw-file", str(song))
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    assert page.evaluate("[...document.querySelectorAll('.fw-lane .fw-lane-name')].map((n) => n.textContent)") == ["Piano", "Drums"]
    page.wait_for_function("document.querySelector('.fw-notice').textContent.includes('2 tracks')")
    assert "1 markers" in page.text_content(".fw-notice") and "100 BPM" in page.text_content(".fw-notice")

    with page.expect_download() as got:
        _menu(page, "File", "Export MIDI file")
    out = mido.MidiFile(got.value.path())
    assert out.type == 1 and out.ticks_per_beat == 480
    names = [next((m.name for m in t if m.type == "track_name"), None) for t in out.tracks]
    assert names[1:] == ["Piano", "Drums"]
    meta = {m.type: m for m in out.tracks[0] if m.is_meta}
    at, tempos = 0, []
    for m in out.tracks[0]:
        at += m.time
        if m.type == "set_tempo":
            tempos.append((at, round(mido.tempo2bpm(m.tempo), 3)))
    # S11: the file's tempo change and its 6/8 come in with it and go back out as they were (the change 4 quarters in,
    # 1920 at 480 a quarter; before the map the 6/8 was kept as three quarters a bar)
    assert tempos == [(0, 100.0), (1920, 150.0)] and (meta["time_signature"].numerator, meta["time_signature"].denominator) == (6, 8)
    ticks, markers = 0, []
    for m in out.tracks[0]:
        ticks += m.time
        if m.type == "marker":
            markers.append((m.text, ticks))
    assert markers == [("Verse", 960)]
    def played(track):
        at, rows = 0, []
        for m in track:
            at += m.time
            if not m.is_meta:
                rows.append((at, m.type, getattr(m, "channel", None), getattr(m, "note", None) or getattr(m, "program", None) or getattr(m, "control", None) or getattr(m, "pitch", None)))
        return rows
    piano, drums = played(out.tracks[1]), played(out.tracks[2])
    assert (0, "program_change", 0, 5) in piano and (0, "control_change", 0, 7) in piano and (240, "pitchwheel", 0, 4096) in piano
    assert [(a, n) for a, kind, _, n in piano if kind == "note_on"] == [(0, 60), (480, 64)]
    assert [(a, n) for a, kind, _, n in piano if kind == "note_off"] == [(480, 60), (960, 64)]
    assert {c for _, kind, c, _ in drums if kind == "note_on"} == {9} and [(a, n) for a, kind, _, n in drums if kind == "note_on"] == [(0, 36), (960, 38)]

    with page.expect_download() as got:
        _menu(page, "File", "Export MusicXML")
    score = music21.converter.parse(got.value.path(), format="musicxml")
    parts = score.parts
    assert [p.partName for p in parts] == ["Piano", "Drums"]
    notes = [(n.pitch.nameWithOctave, float(n.quarterLength)) for n in parts[0].recurse().notes]
    assert notes == [("C4", 1.0), ("E4", 1.0)]
    assert [(n.pitch.midi, float(n.quarterLength), float(n.getOffsetInHierarchy(parts[1]))) for n in parts[1].recurse().notes] == [(36, 0.5, 0.0), (38, 0.5, 2.0)]
    assert parts[0].recurse().getElementsByClass("TimeSignature")[0].ratioString == "6/8"

    page.evaluate("document.querySelector('[data-panel=\"score\"]').click()")
    page.wait_for_selector(".fw-score-body svg")
    svg = page.evaluate("({ ...document.querySelector('.fw-score-body svg').dataset })")
    assert svg == {"measures": "1", "heads": "4"}
    assert page.evaluate("document.querySelectorAll('.fw-score-body svg ellipse.head').length") == 4

    page.click('[data-agent-tab="history"]')
    _menu(page, "Event", "New note clip")
    page.wait_for_function("!document.querySelector('.fw-piano').hidden")
    page.click(".fw-piano [data-step]")
    for key in ("a", "s", "d", "Space", "k"):
        page.keyboard.press(key)
    _step(page, "Step input")
    page.wait_for_function(f"{NOTES_STATE}.endsWith('4 notes')")
    page.click(".fw-piano [data-list]")
    rows = page.evaluate(ROWS)
    assert [r[1] for r in rows] == ["C4", "D4", "E4", "C5"]
    starts = [r[0] for r in rows]
    # S11: the file's 6/8 is kept, so the counter's beats are eighths (480 ticks)
    assert starts == ["1| 1| 000", "1| 1| 240", "1| 2| 000", "1| 3| 000"]
    page.evaluate("document.dispatchEvent(new CustomEvent('fw-midi-note', { detail: { pitch: 67, velocity: 90 } })); document.dispatchEvent(new CustomEvent('fw-midi-note', { detail: { pitch: 71, velocity: 90 } }))")
    page.wait_for_function(f"{NOTES_STATE}.endsWith('6 notes')", timeout=10000)
    rows = page.evaluate(ROWS)
    assert [(r[0], r[1]) for r in rows[4:]] == [("1| 3| 240", "G4"), ("1| 3| 240", "B4")]
    assert _clean(page)["errors"] == []


def test_the_more_lanes_row_draws_mute_trim_vca_send_and_master_lanes_coalesces_a_vca_and_the_track_menu_moves_volume_each_in_one_step(page, app_url):
    import json

    req = urllib.request.Request(app_url + "/api/media", data=(FIXTURES / "jfk.wav").read_bytes(), method="POST", headers={"x-formwav-local": "1", "X-Filename": "jfk.wav"})
    ref = json.loads(urllib.request.urlopen(req, timeout=60).read())
    frames = int(ref["frames"])
    doc = {"sampleRate": ref["sampleRate"], "media": {ref["id"]: ref}, "markers": [], "tracks": [
        {"id": "t1", "name": "Voice", "channels": ref["channels"], "gainDb": -2, "mute": False, "solo": False, "vcaId": "v1", "sends": [{"busId": "b1", "gainDb": -9}], "clips": [{"id": "c1", "mediaId": ref["id"], "start": 0, "length": frames, "sourceIn": 0, "gainDb": 0}]},
    ], "buses": [{"id": "b1", "name": "Verb", "gainDb": 0, "pan": 0}], "vcas": [{"id": "v1", "name": "Dialogue", "gainDb": -4}]}
    _engine(app_url, "PUT", "/api/autosave", {"name": "Lanes", "document": doc})
    try:
        _open(page, app_url)
        page.wait_for_selector("dialog.fw-ask-dialog[open]")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 1")
    finally:
        _engine(app_url, "DELETE", "/api/autosave")
    page.click('[data-agent-tab="history"]')
    page.click(".fw-lane .fw-auto-toggle")
    select = ".fw-lane select.fw-auto-fx"
    options = page.evaluate(f"[...document.querySelector('{select}').options].map((o) => [o.value, o.textContent])")
    assert options == [["mute:", "Mute"], ["trim:", "Trim"], ["vca:", "VCA · Dialogue"], ["send:b1", "Send · Verb"], ["master:", "Master volume"]]
    row = '.fw-lane .fw-auto-row[data-param="fx"]'
    for value, label in [("mute:", "Drew automation on Voice"), ("trim:", "Drew automation on Voice"), ("vca:", "Drew VCA automation"), ("send:b1", "Drew send automation on Voice"), ("master:", "Drew master automation")]:
        page.select_option(select, value)
        box = page.locator(row).bounding_box()
        page.mouse.click(box["x"] + 150, box["y"] + box["height"] * 0.2)
        _step(page, label)
        assert page.locator(f"{row} circle").count() == 1
    page.select_option(select, "mute:")
    assert page.get_attribute(f"{row} circle", "cy") == f"{5 + 0.15 * (48 - 10):.1f}"
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-dock-tab[data-panel="mixer"]')
    vca = '.fw-strip[data-kind="vca"]'
    page.click(f"{vca} details.fw-strip-route > summary")
    page.click(f"{vca} .fw-strip-coalesce")
    _step(page, "Coalesced a VCA into its tracks")
    _range(page, 2, 5)
    _menu(page, "Track", "Write the volume across the selection")
    _step(page, "Wrote the volume on Voice")
    _range(page, 1, 6)
    _menu(page, "Track", "Glide the volume across the selection")
    _step(page, "Glided the volume on Voice")
    _menu(page, "Track", "Volume automation to clip gain")
    _step(page, "Moved the volume into clip gain on Voice")
    _menu(page, "Track", "Clip gain to volume automation")
    _step(page, "Moved clip gain into the volume on Voice")
    page.select_option(select, "vca:")
    assert page.locator(f"{row} circle").count() == 0
    assert _clean(page)["errors"] == []


def test_every_send_shows_on_the_strip_with_pre_mute_and_pan_a_bus_plays_into_a_bus_and_groups_link_faders_and_ranges(page, app_url):
    import json

    req = urllib.request.Request(app_url + "/api/media", data=(FIXTURES / "jfk.wav").read_bytes(), method="POST", headers={"x-formwav-local": "1", "X-Filename": "jfk.wav"})
    ref = json.loads(urllib.request.urlopen(req, timeout=60).read())
    frames = int(ref["frames"])
    track = lambda tid, name, gain: {"id": tid, "name": name, "channels": ref["channels"], "gainDb": gain, "mute": False, "solo": False, "clips": [{"id": f"c{tid}", "mediaId": ref["id"], "start": 0, "length": frames, "sourceIn": 0, "gainDb": 0}]}
    doc = {"sampleRate": ref["sampleRate"], "media": {ref["id"]: ref}, "markers": [], "tracks": [track("t1", "Voice", 0), track("t2", "Room", -6)],
           "buses": [{"id": "b1", "name": "Verb", "gainDb": 0, "pan": 0}, {"id": "b2", "name": "Stem", "gainDb": 0, "pan": 0}]}
    _engine(app_url, "PUT", "/api/autosave", {"name": "Routing", "document": doc})
    try:
        _open(page, app_url)
        page.wait_for_selector("dialog.fw-ask-dialog[open]")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    finally:
        _engine(app_url, "DELETE", "/api/autosave")
    page.click('[data-agent-tab="history"]')
    _range(page, 1, 3)
    page.click('.fw-lane[data-key="t2"] .fw-lane-head', modifiers=["Shift"], position={"x": 40, "y": 8})
    page.wait_for_function("[...document.querySelectorAll('.fw-range')].filter((r) => !r.hidden).length === 2")
    _menu(page, "Track", "Group selected tracks...")
    page.wait_for_selector("dialog.fw-ask-dialog[open]")
    page.keyboard.press("Enter")
    _step(page, "Grouped tracks")
    page.keyboard.press("Escape")
    _range(page, 1, 3)
    page.wait_for_function("[...document.querySelectorAll('.fw-range')].filter((r) => !r.hidden).length === 2")
    page.keyboard.press("s")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 6")
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click('.fw-dock-tab[data-panel="mixer"]')
    t1, t2 = '.fw-strip[data-key="t1"]', '.fw-strip[data-key="t2"]'
    page.evaluate(f"(() => {{ const f = document.querySelector('{t1} .fw-strip-fader'); f.value = '-3'; f.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()")
    _step(page, "Changed the volume of Voice")
    page.wait_for_function(f"document.querySelector('{t2} .fw-strip-fader').value === '-9'")
    page.click(f"{t1} details.fw-strip-route > summary")
    page.select_option(f"{t1} .fw-strip-send", "b1")
    _step(page, "Changed a send on Voice")
    row = f'{t1} .fw-send-row[data-key="b1"]'
    assert page.text_content(f"{row} .fw-send-name") == "Verb"
    assert page.evaluate(f"[...document.querySelector('{t1} .fw-strip-send').options].map((o) => o.value)") == ["", "b2"]
    page.click(f"{row} .fw-send-pre")
    page.wait_for_function(f"document.querySelector('{row} .fw-send-pre').getAttribute('aria-pressed') === 'true'")
    page.click(f"{row} .fw-send-mute")
    page.wait_for_function(f"document.querySelector('{row} .fw-send-mute').getAttribute('aria-pressed') === 'true'")
    page.click(f"{row} .fw-send-remove")
    page.wait_for_function(f"!document.querySelector('{row}')")
    page.click(f"{t1} details.fw-strip-route > summary")
    b1, b2 = '.fw-strip[data-key="b1"]', '.fw-strip[data-key="b2"]'
    page.click(f"{b1} details.fw-strip-route > summary")
    page.select_option(f"{b1} .fw-strip-bus-out", "b2")
    _step(page, "Routed a bus")
    assert page.evaluate(f"[...document.querySelector('{b2} .fw-strip-bus-out').options].map((o) => o.value)") == [""]
    _menu(page, "Track", "Ungroup")
    _step(page, "Ungrouped tracks")
    assert _clean(page)["errors"] == []


def test_tempo_meter_key_and_chord_rulers_take_changes_by_double_click_and_the_event_menu_ramps_and_stretches_the_tempo(page, app_url):
    page.add_init_script("try { localStorage.setItem('formwav.rulers', JSON.stringify(['tempo', 'meter', 'key', 'chords'])); } catch {}")
    notes = [{"at": 0, "length": 96000, "pitch": p, "velocity": 90} for p in (60, 64, 67)]
    doc = {"sampleRate": 48000, "media": {}, "markers": [], "tempo": {"bpm": 120, "beatsPerBar": 4}, "loop": {"start": 0, "end": 192000, "enabled": False}, "tracks": [
        {"id": "t1", "name": "Keys", "channels": 2, "gainDb": 0, "mute": False, "solo": False, "clips": [{"id": "c1", "mediaId": "", "start": 0, "length": 384000, "sourceIn": 0, "gainDb": 0, "notes": notes}]},
    ]}
    _engine(app_url, "PUT", "/api/autosave", {"name": "Tempo", "document": doc})
    try:
        _open(page, app_url)
        page.wait_for_selector("dialog.fw-ask-dialog[open]")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 1")
    finally:
        _engine(app_url, "DELETE", "/api/autosave")
    page.click('[data-agent-tab="history"]')
    assert page.evaluate("[...document.querySelectorAll('.fw-ruler-names span')].length") == 4
    top = page.evaluate("document.querySelector('.fw-ruler-corner').offsetHeight")
    canvas = page.locator(".fw-ruler-canvas").first
    dialog = "dialog.fw-ask-dialog[open]"

    def change(row: int, x: float, field: str, value: str, label: str) -> None:
        canvas.dblclick(position={"x": x, "y": top + row * 20 + 10})
        page.wait_for_selector(dialog)
        if page.locator(f"{dialog} select[data-k='{field}']").count():
            page.select_option(f"{dialog} select[data-k='{field}']", value)
        else:
            page.fill(f"{dialog} [data-k='{field}']", value)
        page.keyboard.press("Enter")
        _step(page, label)

    px = page.evaluate("document.querySelector('.fw-ruler-canvas').getBoundingClientRect().width") / 8
    change(1, 2 * px + 20, "num", "3", "Changed the meter map")
    change(2, 2 * px + 20, "key", "A minor", "Changed the key map")
    change(0, 1 * px + 20, "bpm", "90", "Changed the tempo map")
    _menu(page, "Event", "Tempo ramp across the selection")
    page.wait_for_selector(dialog)
    page.fill(f"{dialog} [data-k='end']", "140")
    page.keyboard.press("Enter")
    _step(page, "Ramped the tempo")
    _menu(page, "Event", "Stretch the selection's tempo")
    page.wait_for_selector(dialog)
    page.keyboard.press("Enter")
    _step(page, "Stretched the tempo")
    assert _clean(page)["errors"] == []


def test_the_demo_session_opens_from_the_file_menu_and_agents_read_and_change_the_open_session_through_the_engine(page, app_url):
    _open(page, app_url)
    _menu(page, "File", "Open the demo session")
    page.wait_for_function("document.querySelectorAll('.fw-lane').length === 6", timeout=60000)
    assert page.evaluate("[...document.querySelectorAll('.fw-lane .fw-lane-name')].map((n) => n.textContent)") == ["Kick", "Snare", "Hats", "Bass", "Pad", "Keys"]
    page.click('[data-agent-tab="history"]')
    _engine(app_url, "POST", "/api/agents/outside", {"outside": "allow"})
    try:
        state = _engine(app_url, "POST", "/api/commands/session.get-session-state", {"params": {}})
        assert state["ok"] and [t["name"] for t in state["result"]["tracks"]] == ["Kick", "Snare", "Hats", "Bass", "Pad", "Keys"]
        assert state["result"]["buses"][0]["name"] == "Verb" and state["result"]["tempo"]["bpm"] == 104 and state["result"]["unsaved"] is True and state["result"]["saved_as"] is None
        listed = _engine(app_url, "POST", "/api/commands/session.list-document-commands", {"params": {"text": "route-bus"}})
        assert [c["type"] for c in listed["result"]] == ["route-bus"]
        applied = _engine(app_url, "POST", "/api/commands/session.apply-document-commands", {"params": {"commands": [{"type": "set-track-gain", "trackId": "demo1", "gainDb": -20}, {"type": "set-track-mute", "trackId": "demo3", "mute": True}], "label": "Quieter drums"}})
        assert applied["ok"] and applied["result"] == {"changed": True, "step": "Quieter drums"}
        _step(page, "Quieter drums")
        refused = _engine(app_url, "POST", "/api/commands/session.apply-document-commands", {"params": {"commands": [{"type": "explode"}]}})
        assert not refused["ok"] and "no engine command explode" in refused["error"]
        after = _engine(app_url, "POST", "/api/commands/session.get-session-state", {"params": {}})["result"]
        assert after["tracks"][0]["gain_db"] == -20 and after["tracks"][2]["mute"] is True and after["undo"] == "Quieter drums" and after["steps"] == 1
    finally:
        _engine(app_url, "POST", "/api/agents/outside", {"outside": "ask"})
    assert _clean(page)["errors"] == []


def test_commands_focus_keys_shortcuts_window_clip_gain_paste_special_templates_and_revert(page, app_url):
    _open(page, app_url)
    _import_speech(page)
    page.click('[data-agent-tab="history"]')
    clip = page.locator(".fw-lane .fw-clip").first
    box = clip.bounding_box()
    # Commands Focus: B separates at the playhead, A trims the start to it
    page.locator(".fw-ruler-canvas").first.click(position={"x": 300, "y": 10})
    clip.click(position={"x": 40, "y": box["height"] * 0.8})
    _menu(page, "View", "Commands Focus")
    page.keyboard.press("b")
    page.wait_for_function("document.querySelectorAll('.fw-lane .fw-clip').length === 2")
    page.keyboard.press("?")
    page.wait_for_selector(".fw-shortcuts-dialog[open]")
    assert page.locator(".fw-shortcuts-row").count() > 20
    page.fill(".fw-shortcuts-filter", "trim end")
    assert page.evaluate("[...document.querySelectorAll('.fw-shortcuts-row')].filter((r) => !r.hidden).map((r) => r.querySelector('kbd').textContent)") == ["S"]
    page.keyboard.press("Escape")
    _menu(page, "View", "Commands Focus")
    # clip gain: set, copy onto the other clip, bypass, render
    first = page.locator(".fw-lane .fw-clip").first
    first.click(position={"x": 40, "y": box["height"] * 0.8})
    _engine(app_url, "POST", "/api/agents/outside", {"outside": "allow"})
    try:
        state = _engine(app_url, "POST", "/api/commands/session.get-session-state", {"params": {}})["result"]
        ids = [c["id"] for c in state["tracks"][0]["clips"]]
        tid = state["tracks"][0]["id"]
        _engine(app_url, "POST", "/api/commands/session.apply-document-commands", {"params": {"commands": [{"type": "set-clip-gain", "trackId": tid, "clipId": ids[0], "gainDb": -6}]}})
        _menu(page, "Clip", "Copy clip gain")
        page.locator(".fw-lane .fw-clip").nth(1).click(position={"x": 40, "y": box["height"] * 0.8})
        _menu(page, "Clip", "Paste clip gain")
        _step(page, "Pasted clip gain onto 1 clip")
        for label in ("Bypassed clip gain", "Restored clip gain"):
            _menu(page, "Clip", "Bypass clip gain")
            _step(page, label)
        _menu(page, "Clip", "Render clip gain")
        _step(page, "Rendered clip gain on 1 clip")
        after = _engine(app_url, "POST", "/api/commands/session.get-session-state", {"params": {}})["result"]["tracks"][0]["clips"]
        assert [c["gain_db"] for c in after] == [-6, 0] and after[1]["media"].endswith("(clip gain).wav")
    finally:
        _engine(app_url, "POST", "/api/agents/outside", {"outside": "ask"})
    # Paste Special: the copied clip repeated across a range
    page.locator(".fw-lane .fw-clip").first.click(position={"x": 40, "y": box["height"] * 0.8})
    page.keyboard.press("ControlOrMeta+c")
    _range(page, 4, 10)
    _menu(page, "Edit", "Paste special: repeat to fill selection")
    _step(page, "Repeated to fill the selection")
    filled = page.evaluate("document.querySelectorAll('.fw-lane')[0].querySelectorAll('.fw-clip').length")
    assert filled >= 4 and page.text_content(".fw-notice").startswith("Filled 6.00 s with")
    # Save, change, revert; save as a template and start a session from it
    page.fill("input.fw-session-name", "Workflow")
    _menu(page, "File", "Save")
    page.wait_for_function("document.querySelector('.fw-notice').textContent === 'Saved Workflow'")
    page.keyboard.press("ControlOrMeta+z")
    page.once("dialog", lambda d: d.accept())
    _menu(page, "File", "Revert to saved")
    page.wait_for_function("document.querySelector('.fw-notice').textContent === 'Opened Workflow'")
    assert page.evaluate("document.querySelectorAll('.fw-lane')[0].querySelectorAll('.fw-clip').length") == filled
    _menu(page, "File", "Save as template")
    page.wait_for_selector("dialog.fw-ask-dialog[open]")
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelector('.fw-notice').textContent.startsWith('Saved the template Workflow template')")
    page.evaluate("document.querySelector('.fw-topbar [data-action=\"open\"]').click()")
    page.locator(".fw-popover-row", has_text="Workflow template").click()
    page.wait_for_function("document.querySelector('.fw-notice').textContent === 'Started a new session from the template Workflow template'")
    assert page.locator(".fw-lane").count() == 1 and page.locator(".fw-lane .fw-clip").count() == 0
    assert page.input_value("input.fw-session-name") == "Untitled"
    assert page.locator("[data-postroll]").count() == 1
    assert _clean(page)["errors"] == []
