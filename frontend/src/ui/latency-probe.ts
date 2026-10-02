/**
 * Spike A's latency probe, reachable inside the app (the desktop app has no address bar): a Measure button beside the
 * transport's Latency field opens a dialog holding /latency-probe.html, which reads the audio context's latencies and
 * measures the round trip through a loopback cable; the figure it reports goes in the Latency field, which already
 * moves each take back by that much. The dialog is made once and the probe loads on first open.
 */
export function mountLatencyProbe(host: HTMLElement): void {
  const field = host.querySelector<HTMLInputElement>("[data-latency]");
  const label = field?.closest("label");
  if (!label) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn fw-latency-measure";
  button.textContent = "Measure";
  button.title = "Measure this machine's round trip with a loopback cable (output to input), then type it into Latency";
  label.after(button);

  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog fw-latency-dialog";
  dialog.setAttribute("aria-label", "Measure latency");
  dialog.innerHTML = `<div class="fw-latency-head"><strong>Measure latency</strong><button type="button" class="fw-ibtn" data-close>Close</button></div><iframe class="fw-latency-frame" title="Latency probe" allow="microphone; clipboard-write"></iframe>`;
  document.body.append(dialog);
  const frame = dialog.querySelector<HTMLIFrameElement>("iframe") as HTMLIFrameElement;

  button.addEventListener("click", () => {
    if (!frame.src) frame.src = "/latency-probe.html";
    dialog.showModal();
  });
  dialog.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close]")) dialog.close();
  });
}
