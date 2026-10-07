import os
import socket
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
    page.fill(".fw-agent-ask textarea", "Lower the track by 6 dB, fade its clip in and out, and mark one second")
    page.click('[data-agent="run"]')
    page.wait_for_function("document.querySelector('.fw-agent-log').textContent.includes('Done:')", timeout=60000)
    calls = anthropic.REQUESTS
    assert [c["path"] for c in calls] == ["/v1/messages"] * 3
    assert all(c["key"] == "stand-in" and len(c["tools"]) == 30 and "get_session" in c["tools"] for c in calls)
    assert len(calls[2]["results"]) == 3 and not any(r.get("is_error") for r in calls[2]["results"])
    assert page.locator('[data-agent="undo"]').is_enabled()
    if page.locator(".fw-dock").is_hidden():
        page.click('.fw-panel-toggle[data-pane="editor"]')
    page.click(".fw-dock-more > .fw-menu-btn")
    page.click('.fw-dock-more [data-panel="labels"]')
    labels = page.evaluate("[...document.querySelectorAll('.fw-labels-list .fw-label-row')].map((r) => [r.querySelector('.fw-label-time').textContent, r.querySelector('.fw-label-text').value])")
    assert labels == [["00:01.000", "agent"]]
    assert _clean(page)["errors"] == []
