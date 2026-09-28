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
import { revealApp } from "./vendor/nodemode/dom-stable";
import { applyTheme } from "./vendor/nodemode/themes";

applyTheme();
const engine = createEngine();
const host = document.getElementById("app");
if (host) {
  mountShell(host, engine);
  mountSession(host, engine);
}
activateAll(engine);
document.fonts.ready.then(revealApp, revealApp);
