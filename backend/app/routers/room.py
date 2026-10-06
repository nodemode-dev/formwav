"""Remote recording, a track per guest (the comparison's Remote recording row): devices paired through routers/remote.py
join a room; the desktop starts and stops a take; each guest records its own microphone where it sits (lossless, the
browser's processing off) and sends the take when the desktop stops, and the desktop places each on its own track.

Time: every answer carries the engine's clock, so a guest can tell, to within its round trip on the local network,
when on the engine's clock its first sample was taken; the take's offset is that against the take's start. The state
is in memory: a room lasts as long as the engine runs, and takes are media like any other once they arrive.
"""

import threading
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from ..services import media
from . import remote

router = APIRouter(prefix="/room", tags=["room"])
page_router = APIRouter()  # /room itself, the guests' page (outside /api; the network listener admits paired devices only)

ONLINE_FOR = 6.0  # seconds since a guest last checked in for it to count as here
MAX_TAKE = 2 * 1024 * 1024 * 1024
_lock = threading.Lock()
_room: dict = {"take": None, "guests": {}, "arrived": []}


def _guest(request: Request) -> dict | None:
    """The paired device behind a request through the network listener; None for the desktop."""
    if not request.scope.get("formwav.remote"):
        return None
    device = remote.device_for(remote._token({k.lower(): v for k, v in request.headers.items()}))
    if device is None:
        raise HTTPException(403, "pair this device first")
    return device


def _public(now: float) -> dict:
    guests = [
        {"id": g["id"], "name": g["name"], "state": g["state"], "online": now - g["seen"] < ONLINE_FOR}
        for g in _room["guests"].values()
    ]
    return {"now": now, "take": _room["take"], "guests": guests, "arrived": list(_room["arrived"])}


@router.get("")
def state(request: Request, status: str = "") -> dict:
    """The room as it stands, with the engine's clock. A guest's call is its check-in, with its state."""
    device = _guest(request)
    now = time.time()
    with _lock:
        if device is not None:
            guest = _room["guests"].setdefault(device["id"], {"id": device["id"], "name": device["name"], "state": "waiting", "seen": now})
            guest.update(name=device["name"], seen=now)
            if status in ("waiting", "recording", "sending", "sent", "no-microphone"):
                guest["state"] = status
        out = _public(now)
    out["me"] = {"guest": device is not None, "id": device["id"] if device else None, "name": device["name"] if device else None}
    return out


@router.post("/start")
def start(request: Request) -> dict:
    """The desktop starts a take for every guest in the room."""
    if _guest(request) is not None:
        raise HTTPException(403, "only the desktop starts a take")
    with _lock:
        _room["take"] = {"id": uuid.uuid4().hex[:12], "started": time.time(), "stopped": None}
        for guest in _room["guests"].values():
            guest["state"] = "waiting"
        return _public(time.time())


@router.post("/stop")
def stop(request: Request) -> dict:
    if _guest(request) is not None:
        raise HTTPException(403, "only the desktop stops a take")
    with _lock:
        if _room["take"] and _room["take"]["stopped"] is None:
            _room["take"]["stopped"] = time.time()
        return _public(time.time())


@router.post("/take")
async def take(request: Request, take: str, started: float) -> dict:
    """A guest's recording of the take (WAV), and when on the engine's clock its first sample was taken."""
    device = _guest(request)
    if device is None:
        raise HTTPException(403, "takes come from guests")
    with _lock:
        current = _room["take"]
    if not current or current["id"] != take:
        raise HTTPException(409, "that take is not the room's current one")
    body = await request.body()
    if not body or len(body) > MAX_TAKE:
        raise HTTPException(413, "the take is empty or larger than 2 GB")
    try:
        ref = media.import_audio(f"{device['name']} (room take).wav", body)
    except media.MediaError as err:
        raise HTTPException(415, str(err)) from err
    offset = round(started - current["started"], 4)
    with _lock:
        _room["arrived"].append({"take": take, "device": device["id"], "name": device["name"], "media": ref, "offset": offset})
        # A device that has just sent a take is here, whether or not it had checked in first
        guest = _room["guests"].setdefault(device["id"], {"id": device["id"], "name": device["name"], "state": "sent", "seen": time.time()})
        guest.update(state="sent", seen=time.time())
    return {"media": ref, "offset": offset}


@router.post("/placed")
def placed(request: Request, body: dict) -> dict:
    """The desktop has placed these arrivals on tracks: they leave the list."""
    if _guest(request) is not None:
        raise HTTPException(403, "only the desktop places takes")
    ids = {str(i) for i in body.get("media", [])}
    with _lock:
        _room["arrived"] = [a for a in _room["arrived"] if a["media"]["id"] not in ids]
        return _public(time.time())


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>formwav: recording room</title><style>
:root{color-scheme:dark;--bg:#151515;--panel:#1e1e1e;--line:#2a2a2a;--text:#ededed;--muted:#a4a4a4;--accent:#f97316}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
main{box-sizing:border-box;inline-size:min(420px,calc(100vw - 32px));display:grid;gap:14px;padding:22px;background:var(--panel);border:1px solid var(--line);border-radius:14px}
h1{margin:0;font-size:18px}.muted{color:var(--muted);font-size:13px;min-block-size:2.9em;margin:0}
label{display:grid;gap:6px;font-size:13px;color:var(--muted)}
select,button{font:inherit;color:var(--text);background:#111;border:1px solid var(--line);border-radius:8px;padding:9px 10px}
button{background:var(--accent);border-color:var(--accent);color:#111;font-weight:600;cursor:pointer}
.meter{block-size:10px;border-radius:5px;background:#111;overflow:hidden}.meter i{display:block;block-size:100%;inline-size:0;background:var(--accent)}
.state{font-size:22px;font-weight:600;min-block-size:1.5em}.recording .state{color:var(--accent)}
</style></head><body><main id="room">
<h1>Recording room</h1>
<p class="muted" id="who">Joining...</p>
<button type="button" id="join">Use this microphone</button>
<label>Microphone <select id="mic" disabled></select></label>
<div class="meter" aria-hidden="true"><i id="level"></i></div>
<div class="state" id="state" aria-live="polite">Not started</div>
<p class="muted" id="note">When the host starts, this device records its own microphone at full quality, and sends the take when the host stops. Keep this page open.</p>
</main><script>
(() => {
  const $ = (id) => document.getElementById(id);
  const say = (el, text) => { if ($(el).textContent !== text) $(el).textContent = text; };
  let ctx = null, source = null, node = null, stream = null, clock = 0, status = "waiting";
  let recording = false, takeId = null, doneId = null, chunks = [], started = null, rate = 48000;
  const engineNow = () => performance.now() + clock;
  async function poll() {
    const t0 = performance.now();
    const r = await fetch("/api/room?status=" + status, { credentials: "same-origin" });
    if (!r.ok) throw new Error("the host refused this device (" + r.status + ")");
    const data = await r.json(); const t1 = performance.now();
    clock = data.now * 1000 - (t0 + t1) / 2;
    return data;
  }
  function wav(samples) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 3, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true);
    v.setUint16(32, 4, true); v.setUint16(34, 32, true); w(36, "data"); v.setUint32(40, n * 4, true);
    new Float32Array(buf, 44).set(samples); return new Blob([buf], { type: "audio/wav" });
  }
  async function open(deviceId) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    if (deviceId) audio.deviceId = { exact: deviceId };
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    if (!ctx) {
      ctx = new AudioContext(); rate = ctx.sampleRate;
      const code = "class C extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('c',C)";
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
      node = new AudioWorkletNode(ctx, "c");
      node.port.onmessage = (e) => {
        const block = e.data; let peak = 0;
        for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
        $("level").style.inlineSize = Math.min(100, Math.round(Math.sqrt(peak) * 100)) + "%";
        if (!recording) return;
        if (started === null) started = engineNow() - (block.length / rate) * 1000;
        chunks.push(block);
      };
    }
    if (source) source.disconnect();
    source = ctx.createMediaStreamSource(stream); source.connect(node);
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    const pick = $("mic"); const was = deviceId || (stream.getAudioTracks()[0].getSettings().deviceId || "");
    pick.replaceChildren(...devices.map((d, i) => new Option(d.label || "Microphone " + (i + 1), d.deviceId)));
    pick.value = was; pick.disabled = false;
  }
  async function send() {
    status = "sending"; say("state", "Sending your take...");
    const total = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(total); let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    const id = takeId, from = started / 1000; chunks = []; started = null;
    const r = await fetch("/api/room/take?take=" + id + "&started=" + from, { method: "POST", credentials: "same-origin", headers: { "x-formwav-local": "1", "content-type": "audio/wav" }, body: wav(all) });
    if (!r.ok) throw new Error("the take was refused (" + r.status + ")");
    doneId = id; status = "sent"; say("state", "Sent: the host has your take");
  }
  async function loop() {
    try {
      const data = await poll();
      say("who", data.me.guest ? "Joined as " + data.me.name : "This is the desktop: open this page on a paired phone or computer.");
      const take = data.take;
      if (take && !take.stopped && !recording && take.id !== doneId && ctx) {
        recording = true; takeId = take.id; chunks = []; started = null; status = "recording";
        document.body.classList.add("recording"); say("state", "Recording");
      } else if (recording && (!take || take.stopped || take.id !== takeId)) {
        recording = false; document.body.classList.remove("recording"); await send();
      } else if (!recording && status !== "sent" && ctx) say("state", "Waiting for the host");
    } catch (err) { say("note", String(err && err.message || err)); }
    setTimeout(loop, 700);
  }
  $("join").addEventListener("click", async () => {
    try { await open(""); await ctx.resume(); $("join").hidden = true; say("state", "Waiting for the host"); }
    catch (err) { status = "no-microphone"; say("note", "The microphone could not be opened: " + (err && err.message || err)); }
  });
  $("mic").addEventListener("change", (e) => open(e.target.value).catch((err) => say("note", String(err))));
  loop();
})();
</script></body></html>"""


@page_router.get("/room", response_class=HTMLResponse, include_in_schema=False)
def room_page() -> HTMLResponse:
    return HTMLResponse(PAGE)
