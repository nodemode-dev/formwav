import type { Engine, SessionDoc } from "../engine";
import { renderMix } from "../io/render-client";
import { setText } from "../vendor/nodemode/dom-stable";
import { ICON_SIZE, icon } from "./icons";

const TARGETS: [number, string][] = [
  [-14, "-14 LUFS (streaming)"],
  [-16, "-16 LUFS (podcast)"],
  [-23, "-23 LUFS (broadcast, EBU R 128)"],
];
const MAX_CLIP_GAIN_DB = 12;

/**
 * Loudness normalization. Measures the integrated loudness (BS.1770, through the engine) of the selected
 * clips, or of every clip when none are selected, as they play in the session, then changes each of those
 * clips' gain by the same amount so the measured loudness lands on the target. One undo step.
 */
export function mountNormalize(host: HTMLElement, engine: Engine): void {
  const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]');
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn";
  button.innerHTML = `${icon("waveform", ICON_SIZE.control)}<span>Loudness</span>`;
  button.title = "Normalize the selected clips, or every clip, to a loudness target";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  exportButton?.before(button);

  const pop = document.createElement("div");
  pop.className = "fw-norm";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Normalize loudness");
  pop.innerHTML =
    `<label class="fw-spot-label">Target<select class="fw-norm-target">${TARGETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>` +
    `<button type="button" class="fw-mode fw-norm-apply">Apply</button>` +
    `<output class="fw-norm-status" aria-live="polite"></output>`;
  document.body.append(pop);
  const select = pop.querySelector<HTMLSelectElement>(".fw-norm-target") as HTMLSelectElement;
  const apply = pop.querySelector<HTMLButtonElement>(".fw-norm-apply") as HTMLButtonElement;
  const status = pop.querySelector<HTMLElement>(".fw-norm-status");
  select.value = "-16";

  const close = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const r = button.getBoundingClientRect();
    pop.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.bottom + 6)}px)`;
    setText(status, "");
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    select.focus();
  };
  button.addEventListener("click", () => (pop.hidden ? open() : close()));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || pop.hidden) return;
    e.preventDefault();
    close();
    button.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (!pop.hidden && !pop.contains(t) && !button.contains(t)) close();
  });

  apply.addEventListener("click", async () => {
    const target = Number(select.value);
    const doc = engine.get("document");
    const selected = new Set(
      [...host.querySelectorAll<HTMLElement>('.fw-clip[aria-selected="true"]')].map((n) => n.dataset.key).filter((k): k is string => !!k),
    );
    const chosen = doc.tracks.flatMap((t) => t.clips.filter((c) => selected.size === 0 || selected.has(c.id)).map((c) => ({ trackId: t.id, clip: c })));
    if (!chosen.length) {
      setText(status, "No clips to normalize");
      return;
    }
    const ids = new Set(chosen.map((c) => c.clip.id));
    const only: SessionDoc = { ...doc, tracks: doc.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => ids.has(c.id)) })) };
    apply.disabled = true;
    setText(status, "Measuring");
    try {
      const mix = await renderMix(only);
      if (!Number.isFinite(mix.loudness)) {
        setText(status, "Too quiet to measure");
        return;
      }
      const delta = target - mix.loudness;
      const limited = chosen.some(({ clip }) => clip.gainDb + delta > MAX_CLIP_GAIN_DB);
      engine.dispatch({
        type: "batch",
        commands: chosen.map(({ trackId, clip }) => ({ type: "set-clip-gain" as const, trackId, clipId: clip.id, gainDb: clip.gainDb + delta })),
      });
      const scope = selected.size ? `${chosen.length} selected clip${chosen.length === 1 ? "" : "s"}` : "all clips";
      setText(status, `${scope}: ${mix.loudness.toFixed(1)} to ${target} LUFS (${delta >= 0 ? "+" : ""}${delta.toFixed(1)} dB)${limited ? "; some clips stopped at +12 dB" : ""}`);
    } catch {
      setText(status, "Could not reach the engine");
    } finally {
      apply.disabled = false;
    }
  });
}
