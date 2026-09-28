import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./vendor/nodemode/tokens.css";
import "./styles/shell.css";
import { createEngine } from "./engine";
import { activateAll } from "./extensions/registry";
import "./extensions/engine-link";
import { mountShell } from "./ui/shell";
import { mountSession } from "./ui/session";
import { mountTransport } from "./ui/transport";
import { mountRecord } from "./ui/record";
import { mountProjects } from "./ui/projects";
import { Player } from "./audio/player";
import { revealApp } from "./vendor/nodemode/dom-stable";
import { applyTheme } from "./vendor/nodemode/themes";

applyTheme();
const engine = createEngine();
const player = new Player(engine);
const host = document.getElementById("app");
if (host) {
  mountShell(host, engine);
  mountSession(host, engine);
  mountTransport(host, engine, player);
  mountRecord(host, engine, player);
  mountProjects(host, engine, player);
}
if (import.meta.env.DEV) Object.assign(window, { __formwav: { engine, player } });
activateAll(engine);
document.fonts.ready.then(revealApp, revealApp);
