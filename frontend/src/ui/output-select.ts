import type { Player } from "../audio/player";
import { nativeChoice, setOutputChoice } from "../audio/native-node";

/**
 * The status bar's Output: the browser's own audio (the worklet), or the engine's native output on the system's
 * default device or a named one, listed from /api/audio/devices (only when the engine has native output). Switching
 * drops the current output without touching the session; the next play uses the new one.
 */
export function mountOutputSelect(host: HTMLElement, player: Player): void {
  const select = host.querySelector<HTMLSelectElement>("[data-output]");
  if (!select) return;
  const option = (value: string, label: string) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  };
  select.replaceChildren(option("browser", "Browser"));
  const current = nativeChoice();
  fetch("/api/audio/devices")
    .then((res) => (res.ok ? res.json() : { native: false, devices: [] }))
    .then((d: { native: boolean; devices: string[] }) => {
      if (!d.native) return;
      select.append(option("native:", "Native · system default"), ...d.devices.map((name) => option(`native:${name}`, `Native · ${name}`)));
      select.value = current === null ? "browser" : `native:${current}`;
      if (select.selectedIndex < 0) select.value = "browser";
    })
    .catch(() => {});
  select.addEventListener("change", () => {
    setOutputChoice(select.value === "browser" ? null : select.value.slice("native:".length));
    void player.resetOutput();
  });
}
