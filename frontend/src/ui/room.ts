import type { Engine, MediaRef } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * Remote recording (routers/remote.py, routers/room.py), the desktop's side. Settings > Devices on this network turns
 * the engine's network listener on (formcut's pairing: a six-digit code, five minutes, once) and lists paired devices.
 * Room, beside Rec, shows who is in the room and starts and stops a take; each guest records its own microphone at
 * /room and sends its take when the take stops, and each arriving take is placed on its own track at the playhead the
 * take started from, moved by its measured start offset.
 */
type Device = { id: string; name: string; created: number };
type RemoteState = { enabled: boolean; port: number; addresses: string[]; devices: Device[] };
type TunnelState = { installed: boolean; running: boolean; url: string; error: string };
type Arrival = { take: string; device: string; name: string; media: MediaRef; offset: number };
type RoomState = { now: number; take: { id: string; started: number; stopped: number | null } | null; guests: { id: string; name: string; state: string; online: boolean }[]; arrived: Arrival[] };
const STATE_WORDS: Record<string, string> = { waiting: "ready", recording: "recording", sending: "sending its take", sent: "take received", "no-microphone": "no microphone" };

const call = async <T>(url: string, method = "GET", body?: unknown): Promise<T> => {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  return out as T;
};

export function mountRoom(host: HTMLElement, engine: Engine): void {
  // Settings > Devices on this network
  const devices = document.createElement("dialog");
  devices.className = "fw-export-dialog fw-devices-dialog";
  devices.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Devices on this network</h2>
  <label class="fw-cloud-check"><input type="checkbox" data-d="on"> Let phones and other computers on this network join, after pairing</label>
  <p class="fw-empty-note fw-devices-where" data-d="where"></p>
  <label class="fw-cloud-check"><input type="checkbox" data-d="anywhere"> Give guests a link that works from any network (through cloudflared)</label>
  <p class="fw-empty-note fw-devices-where fw-devices-link"><span data-d="link"></span> <span data-d="url" translate="no"></span></p>
  <div class="fw-dialog-actions fw-devices-pair"><span class="fw-devices-code" data-d="code"></span><button type="button" class="fw-ibtn" data-d="pair">Show a pairing code</button></div>
  <ol class="fw-cloud-list fw-devices-list" aria-label="Paired devices"></ol>
  <p class="fw-empty-note fw-cloud-note" data-d="say" aria-live="polite"></p>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="close">Close</button></div>
</form>`;
  host.append(devices);
  const d = <T extends HTMLElement>(n: string) => devices.querySelector<T>(`[data-d="${n}"]`) as T;
  let timer = 0;
  let linkTimer = 0;
  let linked = false;
  let lanOn = false;
  // PLAN_v12 R12: the tunnel's link (services/tunnel.py); a guest through it reaches pairing and the room only
  const drawLink = (t: TunnelState) => {
    linked = !!t.url;
    d<HTMLInputElement>("anywhere").checked = t.running;
    setText(d("url"), t.url ? `${t.url}/pair` : "");
    setText(d("link"), t.url ? "Guests open this link, enter a pairing code, and reach the recording room only:" : t.error ? t.error : t.running ? "Starting the link..." : t.installed ? "Off: guests must be on this network." : "Needs cloudflared installed on this computer (on a Mac: brew install cloudflared).");
    d<HTMLButtonElement>("pair").disabled = !lanOn && !linked;
    window.clearInterval(linkTimer);
    if (t.running && !t.url && !t.error) linkTimer = window.setInterval(() => void call<TunnelState>("/api/remote/tunnel").then(drawLink, () => undefined), 500);
  };
  const draw = (st: RemoteState) => {
    lanOn = st.enabled;
    d<HTMLInputElement>("on").checked = st.enabled;
    setText(d("where"), !st.enabled ? "Off: the engine answers this computer only." : st.addresses.length ? `On the device, open ${st.addresses.map((a) => `http://${a}:${st.port}/pair`).join(" or ")}` : "On, but no network address was found.");
    d<HTMLButtonElement>("pair").disabled = !st.enabled && !linked;
    const list = devices.querySelector<HTMLOListElement>(".fw-devices-list") as HTMLOListElement;
    list.replaceChildren(...st.devices.map((dev) => {
      const li = document.createElement("li");
      li.className = "fw-cloud-item";
      li.innerHTML = `<span class="fw-cloud-name"></span><span class="fw-cloud-size"></span><button type="button" class="fw-ibtn">Remove</button>`;
      setText(li.querySelector(".fw-cloud-name"), dev.name);
      setText(li.querySelector(".fw-cloud-size"), `paired ${new Date(dev.created * 1000).toLocaleDateString()}`);
      (li.querySelector("button") as HTMLButtonElement).dataset.remove = dev.id;
      return li;
    }));
    if (!st.enabled && !linked) {
      window.clearInterval(timer);
      setText(d("code"), "");
    }
    setText(d("say"), (st.enabled || linked) && !st.devices.length ? "No device paired yet." : "");
  };
  const refreshDevices = () => call<RemoteState>("/api/remote").then(draw, (e) => setText(d("say"), String(e.message ?? e)));
  devices.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).dataset.d === "anywhere") {
      void call<TunnelState>("/api/remote/tunnel", "PUT", { enabled: d<HTMLInputElement>("anywhere").checked }).then(drawLink, (err) => setText(d("say"), err.message));
      return;
    }
    if ((e.target as HTMLElement).dataset.d !== "on") return;
    void call<RemoteState>("/api/remote", "PUT", { enabled: d<HTMLInputElement>("on").checked }).then(draw, (err) => setText(d("say"), err.message));
  });
  devices.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.remove) void call<RemoteState>(`/api/remote/devices/${b.dataset.remove}`, "DELETE").then(draw, (err) => setText(d("say"), err.message));
    if (b.dataset.d === "pair") {
      void call<{ code: string; expiresIn: number }>("/api/remote/code", "POST", {}).then((made) => {
        const until = Date.now() + made.expiresIn * 1000;
        const tick = () => {
          const left = Math.max(0, Math.round((until - Date.now()) / 1000));
          setText(d("code"), left ? `Code ${made.code} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "");
          if (!left) {
            window.clearInterval(timer);
            void refreshDevices();
          }
        };
        window.clearInterval(timer);
        timer = window.setInterval(() => {
          tick();
          void refreshDevices();
        }, 1000);
        tick();
      }, (err) => setText(d("say"), err.message));
    }
  });
  const item = document.createElement("button");
  item.className = "fw-ibtn";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.dataset.action = "devices";
  item.innerHTML = "<span>Devices on this network…</span>";
  host.querySelector(".fw-settings-pop")?.prepend(item);
  item.addEventListener("click", () => {
    if (!devices.open) devices.showModal();
    void refreshDevices();
    void call<TunnelState>("/api/remote/tunnel").then(drawLink, () => undefined);
  });

  // Room, beside Rec in the transport
  const recPop = host.querySelector("#fw-rec-pop");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn fw-rec-btn fw-room-btn";
  button.setAttribute("popovertarget", "fw-room-pop");
  button.title = "Recording room: guests on paired devices record their own microphones, each onto its own track";
  button.textContent = "Room";
  const pop = document.createElement("div");
  pop.id = "fw-room-pop";
  pop.className = "fw-rec-pop fw-room-pop";
  pop.setAttribute("popover", "");
  pop.innerHTML = `<div class="fw-popover-title">Recording room</div><ol class="fw-room-guests" aria-label="Guests"></ol><p class="fw-empty-note fw-room-note" aria-live="polite"></p><div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-r="stop" disabled>Stop take</button><button type="button" class="fw-ibtn fw-btn-export" data-r="start">Start take</button></div>`;
  recPop?.after(button, pop);
  const note = (t: string) => setText(pop.querySelector(".fw-room-note"), t);
  let startAt: number | null = null;
  let polling = 0;
  const place = async (st: RoomState) => {
    if (!st.arrived.length) return;
    const doc = engine.get("document");
    const rate = doc.sampleRate || 48000;
    const base = startAt ?? engine.get("transport").positionSamples;
    for (const a of st.arrived) engine.dispatch({ type: "import-media", media: a.media, at: Math.max(0, base + Math.round(a.offset * rate)) });
    await call("/api/room/placed", "POST", { media: st.arrived.map((a) => a.media.id) });
    note(`Placed ${st.arrived.map((a) => a.name).join(", ")} on ${st.arrived.length === 1 ? "its own track" : "their own tracks"}.`);
  };
  const drawRoom = (st: RoomState) => {
    const ol = pop.querySelector<HTMLOListElement>(".fw-room-guests") as HTMLOListElement;
    const here = st.guests.filter((g) => g.online || g.state === "sent" || g.state === "sending");
    ol.replaceChildren(...here.map((g) => {
      const li = document.createElement("li");
      li.className = "fw-room-guest";
      li.innerHTML = `<span class="fw-cloud-name"></span><span class="fw-cloud-size"></span>`;
      setText(li.querySelector(".fw-cloud-name"), g.name);
      setText(li.querySelector(".fw-cloud-size"), g.online ? STATE_WORDS[g.state] ?? g.state : "offline");
      return li;
    }));
    const live = !!st.take && st.take.stopped === null;
    (pop.querySelector('[data-r="start"]') as HTMLButtonElement).disabled = live || !here.length;
    (pop.querySelector('[data-r="stop"]') as HTMLButtonElement).disabled = !live;
    button.classList.toggle("is-live", live);
    if (!here.length) note("No guest here yet: pair a device in Settings > Devices on this network, then open /room on it.");
    else if (live) note("Recording: each guest is taking its own microphone.");
  };
  const poll = async () => {
    try {
      const st = await call<RoomState>("/api/room");
      drawRoom(st);
      await place(st);
    } catch {
      /* the engine is away; the next poll tries again */
    }
  };
  const ensurePolling = (on: boolean) => {
    window.clearInterval(polling);
    if (on) polling = window.setInterval(() => void poll(), 1500);
  };
  pop.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-r]");
    if (!b) return;
    try {
      if (b.dataset.r === "start") {
        startAt = engine.get("transport").positionSamples;
        drawRoom(await call<RoomState>("/api/room/start", "POST", {}));
      } else drawRoom(await call<RoomState>("/api/room/stop", "POST", {}));
    } catch (err) {
      note(err instanceof Error ? err.message : String(err));
    }
  });
  // Poll while the listener is on, so takes are placed even with the popover closed
  void call<RemoteState>("/api/remote").then((st) => ensurePolling(st.enabled), () => undefined);
  devices.addEventListener("change", () => window.setTimeout(() => void call<RemoteState>("/api/remote").then((st) => ensurePolling(st.enabled)), 300));
  pop.addEventListener("toggle", () => void poll());
}
