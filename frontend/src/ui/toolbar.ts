/**
 * The arrangement's toolbar on the agreed canvas: Add a track, the Select, Split, Fade and Draw tools, zoom out, in and
 * Fit, Follow, and the hint for the tool in hand. The older options (Grid, Shuffle, Spot, Punch, Bars, Picture, the
 * spectrogram views, layouts, the panels' toggles, speed, recording settings, the room) keep their buttons in the
 * toolbar's hidden store, each still bound by its own module; the menus reach them here as items that press the
 * button and show its state.
 */
import type { Engine } from "../engine";
import { documentLength } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";
import { getZoom, samplesPerPixel, setZoom } from "./lanes";
import { snapSamples } from "./grid";
import { setFollow } from "./transport";

const HINTS: Record<string, string> = {
  split: "Click a clip where it should split.",
  fade: "Drag in from a clip's start or end to fade it in or out.",
  draw: "Zoom in until single samples show, then drag on a clip to draw them.",
};

type Item = { label: string; key?: string; target: () => HTMLElement | null; check?: boolean; run?: () => void; spectral?: boolean };

export function mountToolbar(host: HTMLElement, engine: Engine): void {
  const tray = host.querySelector<HTMLElement>(".fw-tool-tray");
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  if (!tray || !stage) return;
  const seg = tray.querySelector<HTMLElement>(".fw-tools-seg");
  const hint = tray.querySelector<HTMLElement>(".fw-tool-hint");
  const store = tray.querySelector<HTMLElement>(".fw-tray-store");
  const draw = store?.querySelector<HTMLButtonElement>("[data-draw]") ?? null;
  if (seg && draw) {
    seg.append(draw);
    const label = draw.querySelector<HTMLElement>("span");
    if (label) label.dataset.label = label.textContent ?? "";
  }

  tray.querySelector("[data-add-track]")?.addEventListener("click", () => {
    engine.dispatch({ type: "add-track" });
    const t = engine.get("document").tracks.at(-1);
    if (t) setText(notice, `Added ${t.name}: arm it (R) to record into it, or drag media from the browser onto it`);
  });

  let tool = "select";
  const setTool = (next: string) => {
    tool = next;
    if (tray.dataset.tool !== next) tray.dataset.tool = next;
    for (const b of seg?.querySelectorAll<HTMLElement>("[data-tool]") ?? []) {
      const on = String(b.dataset.tool === next);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    setText(hint, HINTS[next] ?? "");
  };
  seg?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
    if (!b?.dataset.tool) return;
    if (draw?.getAttribute("aria-pressed") === "true") draw.click();
    setTool(b.dataset.tool);
  });
  if (draw) {
    new MutationObserver(() => {
      const on = draw.getAttribute("aria-pressed") === "true";
      if (on && tool !== "draw") setTool("draw");
      else if (!on && tool === "draw") setTool("select");
    }).observe(draw, { attributes: true, attributeFilter: ["aria-pressed"] });
  }

  const hit = (e: PointerEvent) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>(".fw-clip");
    const lane = node?.closest<HTMLElement>(".fw-lane");
    const doc = engine.get("document");
    const track = doc.tracks.find((t) => t.id === lane?.dataset.key);
    const clip = track?.clips.find((c) => c.id === node?.dataset.key);
    return node && track && clip ? { node, track, clip, doc } : null;
  };
  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || (tool !== "split" && tool !== "fade")) return;
      const h = hit(e);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = h.node.getBoundingClientRect();
      const spp = samplesPerPixel(h.doc);
      if (tool === "split") {
        const raw = h.clip.start + ((e.clientX - rect.left) / rect.width) * h.clip.length;
        const at = Math.round(snapSamples(raw, h.doc.sampleRate, h.doc.sampleRate / spp));
        if (at > h.clip.start && at < h.clip.start + h.clip.length) {
          engine.dispatch({ type: "split-clip", trackId: h.track.id, clipId: h.clip.id, at });
          setText(notice, `Split ${h.track.name} at ${(at / h.doc.sampleRate).toFixed(3)} s`);
        }
        return;
      }
      const side = e.clientX - rect.left < rect.width / 2 ? "in" : "out";
      const other = side === "in" ? h.clip.fadeOut ?? 0 : h.clip.fadeIn ?? 0;
      const preview = document.createElement("div");
      preview.className = `fw-fade-preview fw-fade-preview-${side}`;
      h.node.append(preview);
      let length = side === "in" ? h.clip.fadeIn ?? 0 : h.clip.fadeOut ?? 0;
      const move = (ev: PointerEvent) => {
        const px = side === "in" ? ev.clientX - rect.left : rect.right - ev.clientX;
        length = Math.round(Math.max(0, Math.min(h.clip.length - other, (px / rect.width) * h.clip.length)));
        preview.style.inlineSize = `${((length / h.clip.length) * 100).toFixed(2)}%`;
      };
      move(e);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        preview.remove();
        engine.dispatch({ type: "set-clip-fades", trackId: h.track.id, clipId: h.clip.id, fadeIn: side === "in" ? length : h.clip.fadeIn ?? 0, fadeOut: side === "out" ? length : h.clip.fadeOut ?? 0, ...(h.clip.fadeShape ? { shape: h.clip.fadeShape } : {}) });
        setText(notice, `Fade ${side} on ${h.track.name}: ${(length / h.doc.sampleRate).toFixed(2)} s`);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    { capture: true },
  );

  tray.querySelector(".fw-zoom")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom], [data-follow]");
    if (!b) return;
    if (b.dataset.zoom === "in") setZoom(getZoom() * 2);
    else if (b.dataset.zoom === "out") setZoom(getZoom() / 2);
    else if (b.dataset.zoom === "fit") {
      const doc = engine.get("document");
      const length = documentLength(doc);
      const head = stage.querySelector<HTMLElement>(".fw-ruler-corner")?.offsetWidth ?? 0;
      const view = stage.clientWidth - head - 24;
      if (length > 0 && view > 0) {
        setZoom((doc.sampleRate * view) / (100 * length));
        stage.scrollLeft = 0;
      }
    } else if (b.hasAttribute("data-follow")) {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      setFollow(on);
    }
  });

  // The menus: each item presses a button that its module still binds, and a checkable one shows that button's state
  const byLabel = (root: Element | null | undefined, label: string) => [...(root?.querySelectorAll<HTMLElement>("button") ?? [])].find((b) => b.textContent?.trim() === label) ?? null;
  const edit = store?.querySelector<HTMLElement>('[data-group="edit"]');
  const view = store?.querySelector<HTMLElement>('[data-group="view"]');
  const transport = host.querySelector<HTMLElement>(".fw-status .fw-transport");
  const q = (sel: string) => () => host.querySelector<HTMLElement>(sel);
  const fill = (popSel: string, items: (Item | "sep")[]) => {
    const pop = host.querySelector<HTMLElement>(popSel);
    if (!pop) return;
    for (const it of items) {
      if (it === "sep") {
        pop.append(Object.assign(document.createElement("span"), { className: "fw-menu-sep" }));
        continue;
      }
      const target = it.target();
      if (!target && !it.run) continue;
      const item = document.createElement("button");
      item.type = "button";
      item.className = it.spectral ? "fw-ibtn fw-needs-spectral" : "fw-ibtn";
      item.setAttribute("role", it.check ? "menuitemcheckbox" : "menuitem");
      item.innerHTML = `<span class="fw-check" aria-hidden="true"></span><span></span>${it.key ? `<kbd>${it.key}</kbd>` : ""}`;
      (item.children[1] as HTMLElement).textContent = it.label;
      if (target?.title) item.title = target.title;
      item.addEventListener("click", () => (it.run ? it.run() : target?.click()));
      if (it.check && target) {
        const sync = () => {
          const on = target.getAttribute("aria-pressed") === "true";
          if (item.getAttribute("aria-checked") !== String(on)) item.setAttribute("aria-checked", String(on));
        };
        new MutationObserver(sync).observe(target, { attributes: true, attributeFilter: ["aria-pressed"] });
        sync();
      }
      pop.append(item);
    }
  };
  fill(".fw-edit-pop", [
    "sep",
    { label: "Shuffle: later clips close the gap", key: "H", target: () => byLabel(edit, "Shuffle"), check: true },
    { label: "Spot: type a clip's exact start", key: "T", target: () => byLabel(edit, "Spot"), check: true },
    { label: "Snap to the grid", key: "G", target: () => byLabel(edit, "Grid"), check: true },
    "sep",
    { label: "Loudness...", target: q(".fw-loud-btn") },
  ]);
  const spectral = view?.querySelector<HTMLSelectElement>(".fw-spectral-tool");
  const pickSpectral = (value: string) => () => {
    if (!spectral) return;
    spectral.value = value;
    spectral.dispatchEvent(new Event("change", { bubbles: true }));
  };
  fill(".fw-view-pop", [
    "sep",
    { label: "Clip", target: () => view?.querySelector("[data-cliptab]") ?? null, check: true },
    { label: "Effects", target: () => view?.querySelector("[data-chain]") ?? null, check: true },
    { label: "Mixer", key: "X", target: () => byLabel(view, "Mixer"), check: true },
    { label: "Synth", target: () => view?.querySelector("[data-synth]") ?? null, check: true },
    { label: "Pads", target: () => view?.querySelector("[data-pads]") ?? null, check: true },
    { label: "Spectrum", target: () => view?.querySelector("[data-spectrum]") ?? null, check: true },
    { label: "Transcript", target: () => view?.querySelector("[data-transcript]") ?? null, check: true },
    { label: "Inspector", target: () => view?.querySelector("[data-inspector]") ?? null, check: true },
    { label: "Notes", target: () => view?.querySelector("[data-piano]") ?? null, check: true },
    { label: "Labels", target: () => view?.querySelector("[data-labels]") ?? null, check: true },
    { label: "Terminal", key: "Ctrl `", target: q('[data-action="terminal"]'), check: true },
    "sep",
    { label: "Picture", target: () => byLabel(view, "Picture"), check: true },
    { label: "Spectrograms", target: () => byLabel(view, "Spectrogram"), check: true },
    { label: "Spectrograms on a log scale", target: () => byLabel(view, "Log Hz"), check: true, spectral: true },
    { label: "Spectral select: box", target: () => spectral ?? null, run: pickSpectral(""), spectral: true },
    { label: "Spectral select: lasso", target: () => spectral ?? null, run: pickSpectral("lasso"), spectral: true },
    { label: "Spectral select: paint", target: () => spectral ?? null, run: pickSpectral("paint"), spectral: true },
    { label: "Bars and beats on the ruler", target: () => byLabel(edit, "Bars"), check: true },
  ]);
  const layouts = view?.querySelector<HTMLSelectElement>(".fw-layout-select");
  const viewPop = host.querySelector<HTMLElement>(".fw-view-pop");
  if (layouts && viewPop) {
    const label = Object.assign(document.createElement("span"), { className: "fw-menu-label", textContent: "Layouts" });
    const box = document.createElement("div");
    box.className = "fw-menu-layouts";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Layouts");
    viewPop.append(Object.assign(document.createElement("span"), { className: "fw-menu-sep" }), label, box);
    const refill = () => {
      box.replaceChildren(
        ...[...layouts.options]
          .filter((o) => o.value)
          .map((o) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "fw-ibtn";
            item.setAttribute("role", "menuitem");
            item.innerHTML = `<span class="fw-check" aria-hidden="true"></span><span></span>`;
            (item.children[1] as HTMLElement).textContent = o.textContent ?? o.value;
            item.addEventListener("click", () => {
              layouts.value = o.value;
              layouts.dispatchEvent(new Event("change", { bubbles: true }));
            });
            return item;
          }),
      );
    };
    refill();
    new MutationObserver(refill).observe(layouts, { childList: true });
  }
  fill(".fw-transport-pop", [
    "sep",
    { label: "Punch in on the loop range", key: "P", target: () => byLabel(edit, "Punch"), check: true },
    { label: "Playback speed...", target: () => transport?.querySelector(".fw-speed-btn") ?? null },
    { label: "Recording settings...", target: () => transport?.querySelector(".fw-rec-btn:not(.fw-room-btn)") ?? null },
    { label: "Recording room...", target: () => transport?.querySelector(".fw-room-btn") ?? null },
  ]);

  setTool("select");
}
