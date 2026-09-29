import type { Player } from "../audio/player";
import type { Engine, SessionDoc, Track } from "../engine";
import type { Bus } from "../engine/document";
import { patchList, setText } from "../vendor/nodemode/dom-stable";
import { icon as fcIcon } from "../vendor/formcut/icons";

type Strip = { kind: "track"; item: Track } | { kind: "bus"; item: Bus } | { kind: "master"; item: { id: string; name: string; gainDb: number } };

function stripNode(kind: Strip["kind"]): HTMLElement {
  const node = document.createElement("div");
  node.className = "fw-strip";
  node.dataset.kind = kind;
  node.innerHTML =
    `<div class="fw-strip-name"></div>` +
    `<div class="fw-strip-meter" aria-hidden="true"><div class="fw-out-track"><div class="fw-out-bar"></div></div><div class="fw-out-track"><div class="fw-out-bar"></div></div></div>` +
    `<input class="fw-strip-fader" type="range" min="-60" max="12" step="0.1" aria-label="Volume">` +
    `<output class="fw-strip-db"></output>` +
    `<input class="fw-strip-pan" type="range" min="-1" max="1" step="0.01" aria-label="Pan"${kind === "master" ? " hidden" : ""}>` +
    `<div class="fw-strip-buttons"${kind === "master" ? " hidden" : ""}><button type="button" class="fw-strip-mute fw-icon-btn" aria-pressed="false" aria-label="Mute" title="Mute"><span class="fw-glyph-off">${fcIcon("speaker")}</span><span class="fw-glyph-on">${fcIcon("mute")}</span></button><button type="button" class="fw-strip-solo fw-icon-btn" aria-pressed="false" aria-label="Solo" title="Solo"${kind !== "track" ? " hidden" : ""}>${fcIcon("headphones")}</button></div>` +
    `<select class="fw-strip-out" aria-label="Output"${kind !== "track" ? " hidden" : ""}></select>`;
  return node;
}

const dbText = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

function setAttr(el: Element | null, name: string, value: string): void {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function updateStrip(node: HTMLElement, strip: Strip, doc: SessionDoc): void {
  setText(node.querySelector(".fw-strip-name"), strip.item.name);
  if (strip.kind === "master") {
    const masterFader = node.querySelector<HTMLInputElement>(".fw-strip-fader");
    if (masterFader && node.dataset.dragging !== "fader") {
      const value = String(strip.item.gainDb);
      if (masterFader.value !== value) masterFader.value = value;
      setText(node.querySelector(".fw-strip-db"), dbText(strip.item.gainDb));
    }
    return;
  }
  const fader = node.querySelector<HTMLInputElement>(".fw-strip-fader");
  const pan = node.querySelector<HTMLInputElement>(".fw-strip-pan");
  const automation = strip.kind === "track" ? strip.item.automation : undefined;
  const volumeAuto = !!automation?.volume?.length;
  const panAuto = !!automation?.pan?.length;
  if (fader && node.dataset.dragging !== "fader") {
    const value = String(strip.item.gainDb);
    if (fader.value !== value) fader.value = value;
    if (fader.disabled !== volumeAuto) fader.disabled = volumeAuto;
    setAttr(fader, "title", volumeAuto ? "Volume follows this track's automation" : "Volume");
    setText(node.querySelector(".fw-strip-db"), volumeAuto ? "auto" : dbText(strip.item.gainDb));
  }
  if (pan) {
    const value = String(strip.item.pan ?? 0);
    if (pan.value !== value) pan.value = value;
    if (pan.disabled !== panAuto) pan.disabled = panAuto;
    setAttr(pan, "title", panAuto ? "Pan follows this track's automation" : `Pan ${(strip.item.pan ?? 0).toFixed(2)}`);
  }
  setAttr(node.querySelector(".fw-strip-mute"), "aria-pressed", String(!!strip.item.mute));
  if (strip.kind === "track") {
    setAttr(node.querySelector(".fw-strip-solo"), "aria-pressed", String(strip.item.solo));
    const out = node.querySelector<HTMLSelectElement>(".fw-strip-out");
    if (out) {
      const options = [["", "Master"], ...(doc.buses ?? []).map((b) => [b.id, b.name])];
      const signature = JSON.stringify(options);
      if (out.dataset.options !== signature) {
        out.dataset.options = signature;
        out.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
      }
      const value = strip.item.busId ?? "";
      if (out.value !== value) out.value = value;
    }
  }
}

/** A console-style mixer docked over the bottom of the timeline, toggled from the transport bar or with X. */
export function mountMixer(host: HTMLElement, engine: Engine, player: Player): void {
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.innerHTML = `${fcIcon("mixer")}<span>Mixer</span>`;
  toggle.title = "Show the mixer (X)";
  toggle.setAttribute("aria-pressed", "false");
  transport?.append(toggle);

  const panel = document.createElement("section");
  panel.className = "fw-mixer";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Mixer");
  const strips = document.createElement("div");
  strips.className = "fw-mixer-strips";
  panel.append(strips);
  host.append(panel);

  const render = (doc: SessionDoc) => {
    if (panel.hidden) return;
    const items: Strip[] = [
      ...doc.tracks.map((item) => ({ kind: "track" as const, item })),
      ...(doc.buses ?? []).map((item) => ({ kind: "bus" as const, item })),
      { kind: "master" as const, item: { id: "master", name: "Master", gainDb: doc.masterGainDb ?? 0 } },
    ];
    patchList(strips, items, {
      key: (s) => s.item.id,
      create: (s) => {
        const node = stripNode(s.kind);
        updateStrip(node, s, doc);
        return node;
      },
      update: (node, s) => updateStrip(node, s, doc),
    });
  };
  engine.subscribe("document", render);

  const setOpen = (open: boolean) => {
    if (open && transport) panel.style.setProperty("--fw-mixer-bottom", `${Math.round(window.innerHeight - transport.getBoundingClientRect().top)}px`);
    panel.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    render(engine.get("document"));
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden !== false));
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "x") return;
    e.preventDefault();
    setOpen(panel.hidden !== false);
  });

  const stripOf = (el: EventTarget | null) => {
    const node = (el as HTMLElement | null)?.closest<HTMLElement>(".fw-strip");
    const id = node?.dataset.key;
    return node && id ? { node, id, bus: node.dataset.kind === "bus" } : null;
  };
  panel.addEventListener("input", (e) => {
    const s = stripOf(e.target);
    if (!s || !(e.target as HTMLElement).classList.contains("fw-strip-fader")) return;
    s.node.dataset.dragging = "fader";
    setText(s.node.querySelector(".fw-strip-db"), dbText(Number((e.target as HTMLInputElement).value)));
  });
  panel.addEventListener("change", (e) => {
    const s = stripOf(e.target);
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!s) return;
    if (el.classList.contains("fw-strip-fader")) {
      delete s.node.dataset.dragging;
      const gainDb = Number(el.value);
      if (s.node.dataset.kind === "master") engine.dispatch({ type: "set-master-gain", gainDb });
      else engine.dispatch(s.bus ? { type: "set-bus-gain", busId: s.id, gainDb } : { type: "set-track-gain", trackId: s.id, gainDb });
    } else if (el.classList.contains("fw-strip-pan")) {
      const pan = Number(el.value);
      engine.dispatch(s.bus ? { type: "set-bus-pan", busId: s.id, pan } : { type: "set-track-pan", trackId: s.id, pan });
    } else if (el.classList.contains("fw-strip-out")) {
      engine.dispatch({ type: "route-track", trackId: s.id, busId: el.value || null });
    }
  });
  panel.addEventListener("click", (e) => {
    const s = stripOf(e.target);
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!s || !button) return;
    const on = button.getAttribute("aria-pressed") !== "true";
    if (button.classList.contains("fw-strip-mute")) engine.dispatch(s.bus ? { type: "set-bus-mute", busId: s.id, mute: on } : { type: "set-track-mute", trackId: s.id, mute: on });
    else if (button.classList.contains("fw-strip-solo") && !s.bus) engine.dispatch({ type: "set-track-solo", trackId: s.id, solo: on });
  });

  const shown = new Map<string, number[]>();
  let lastTime = performance.now();
  const drive = (key: string, selector: string, pair: [number, number], silent: boolean, fall: number) => {
    const previous = shown.get(key) ?? [-Infinity, -Infinity];
    const next = pair.map((peak, c) => (silent ? -Infinity : Math.max(peak > 0 ? 20 * Math.log10(peak) : -Infinity, previous[c] - fall)));
    shown.set(key, next);
    const bars = panel.querySelectorAll<HTMLElement>(selector);
    next.forEach((db, c) => {
      const bar = bars[c];
      if (!bar) return;
      const transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;
      if (bar.style.transform !== transform) bar.style.transform = transform;
    });
  };
  player.onOutputLevel((left, right, _tracks, _loudness, buses) => {
    const now = performance.now();
    const fall = ((now - lastTime) / 1000) * 20;
    lastTime = now;
    drive("master", '.fw-strip[data-kind="master"] .fw-strip-meter .fw-out-bar', [left, right], left === 0 && right === 0, fall);
    // The core meters buses in plan order, which leaves muted buses out; walk the document's buses the same way.
    let k = 0;
    for (const bus of engine.get("document").buses ?? []) {
      const live = !bus.mute;
      const pair: [number, number] = live ? [buses[2 * k] ?? 0, buses[2 * k + 1] ?? 0] : [0, 0];
      if (live) k++;
      drive(bus.id, `.fw-strip[data-key="${bus.id}"] .fw-strip-meter .fw-out-bar`, pair, !live || buses.length === 0, fall);
    }
  });
}
