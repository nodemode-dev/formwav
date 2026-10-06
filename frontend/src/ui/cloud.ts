import type { Engine, MediaRef } from "../engine";
import { savedSessionName } from "./projects";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * Cloud projects (File > Cloud): Google Drive and Dropbox through the engine (routers/cloud.py), adapted from formcut
 * 2.6.3's cloud interface. Set a service up with the app's client ID (and Google's desktop secret), connect it (Google
 * finishes in the browser and comes back to this engine; Dropbox shows a code to paste here), then browse its files: a
 * session (.fmw, its media inside) opens as a project through the projects module's own path, anything else comes in as
 * media on a new track at the playhead, and the session saved here goes up whole. Tokens never reach this page.
 */
type Service = "google" | "dropbox";
type State = { configured: boolean; connected: boolean; clientId: string; fullDrive: boolean };
type Entry = { id: string; name: string; folder: boolean; size: number | null; modified: string | null };
const LABEL: Record<Service, string> = { google: "Google Drive", dropbox: "Dropbox" };

const engineJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  return out as T;
};
const send = <T>(url: string, method: string, body?: unknown) =>
  engineJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const sizeText = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function mountCloud(host: HTMLElement, engine: Engine): void {
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog fw-cloud-dialog";
  dialog.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Cloud</h2>
  <div class="fw-cloud-services" role="radiogroup" aria-label="Service"><button type="button" class="fw-ibtn" role="radio" data-c="google">Google Drive</button><button type="button" class="fw-ibtn" role="radio" data-c="dropbox">Dropbox</button></div>
  <div class="fw-cloud-body">
  <div class="fw-cloud-setup" hidden>
    <label class="fw-field fw-field-stack"><span>Client ID</span><input type="text" data-c="clientId" autocomplete="off" spellcheck="false"></label>
    <label class="fw-field fw-field-stack" data-c="secretRow"><span>Client secret (Google's desktop app secret)</span><input type="password" data-c="clientSecret" autocomplete="off" placeholder="Kept as stored when left empty"></label>
    <label class="fw-cloud-check" data-c="fullRow"><input type="checkbox" data-c="fullDrive"> Browse all of Drive (read access; Google verifies this scope before public use)</label>
    <div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-c="saveApp">Save set-up</button></div>
  </div>
  <div class="fw-cloud-connect" hidden>
    <div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-c="setup">Set up</button><button type="button" class="fw-ibtn" data-c="refresh">Refresh</button><button type="button" class="fw-ibtn fw-btn-export" data-c="connect">Connect</button></div>
    <div class="fw-cloud-paste" hidden><label class="fw-field fw-field-stack"><span>Dropbox's code</span><input type="text" data-c="code" autocomplete="off" spellcheck="false"></label><div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-c="finish">Finish</button></div></div>
  </div>
  <div class="fw-cloud-files" hidden>
    <div class="fw-cloud-bar"><button type="button" class="fw-ibtn" data-c="up" disabled>Back</button><span class="fw-cloud-where"></span><button type="button" class="fw-ibtn" data-c="refresh">Refresh</button></div>
    <ol class="fw-cloud-list" aria-label="Files"></ol>
    <div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-c="disconnect">Disconnect</button><button type="button" class="fw-ibtn fw-cloud-more" data-c="more" data-off disabled>More</button><button type="button" class="fw-ibtn fw-btn-export" data-c="save">Save this session here</button></div>
  </div>
  </div>
  <p class="fw-empty-note fw-cloud-note" aria-live="polite"></p>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="close">Close</button></div>
</form>`;
  host.append(dialog);
  const q = <T extends HTMLElement>(name: string) => dialog.querySelector<T>(`[data-c="${name}"]`) as T;
  const note = (text: string) => setText(dialog.querySelector(".fw-cloud-note"), text);
  const show = (sel: string, on: boolean) => {
    const el = dialog.querySelector<HTMLElement>(sel);
    if (el && el.hidden === on) el.hidden = !on;
  };
  let service: Service = "google";
  let states: Record<Service, State> | null = null;
  let folders: string[] = [""];
  let cursor = "";

  const draw = () => {
    for (const b of dialog.querySelectorAll<HTMLButtonElement>(".fw-cloud-services button")) b.setAttribute("aria-checked", String(b.dataset.c === service));
    const st = states?.[service];
    show(".fw-cloud-setup", !!st && !st.configured);
    show(".fw-cloud-connect", !!st && st.configured && !st.connected);
    show(".fw-cloud-files", !!st && st.connected);
    show('[data-c="secretRow"]', service === "google");
    show('[data-c="fullRow"]', service === "google");
    if (st) {
      q<HTMLInputElement>("clientId").value = st.clientId;
      q<HTMLInputElement>("fullDrive").checked = st.fullDrive;
    }
  };
  const list = async (append = false) => {
    const folder = folders[folders.length - 1];
    if (!append) cursor = "";
    note(`Listing ${LABEL[service]}...`);
    try {
      const page = await engineJson<{ entries: Entry[]; cursor: string }>(`/api/cloud/${service}/files?${new URLSearchParams({ folder, cursor })}`);
      const ol = dialog.querySelector<HTMLOListElement>(".fw-cloud-list") as HTMLOListElement;
      const rows = page.entries.map((e) => {
        const li = document.createElement("li");
        li.className = "fw-cloud-item";
        li.innerHTML = `<span class="fw-cloud-name"></span><span class="fw-cloud-size"></span><button type="button" class="fw-ibtn"></button>`;
        setText(li.querySelector(".fw-cloud-name"), e.folder ? `${e.name}/` : e.name);
        setText(li.querySelector(".fw-cloud-size"), e.folder ? "" : sizeText(e.size));
        const b = li.querySelector("button") as HTMLButtonElement;
        b.textContent = e.folder ? "Open folder" : e.name.toLowerCase().endsWith(".fmw") ? "Open session" : "Import";
        b.dataset.c = e.folder ? "enter" : "take";
        b.dataset.id = e.id;
        b.dataset.name = e.name;
        return li;
      });
      if (append) ol.append(...rows);
      else ol.replaceChildren(...rows);
      cursor = page.cursor;
      q<HTMLButtonElement>("more").toggleAttribute("data-off", !cursor);
      q<HTMLButtonElement>("more").disabled = !cursor;
      q<HTMLButtonElement>("up").disabled = folders.length < 2;
      setText(dialog.querySelector(".fw-cloud-where"), folders.length < 2 ? LABEL[service] : (folders[folders.length - 1].split("/").pop() ?? ""));
      note(ol.children.length ? "" : "Nothing here yet.");
    } catch (err) {
      note(`Could not list ${LABEL[service]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const refresh = async () => {
    try {
      states = await engineJson<Record<Service, State>>("/api/cloud");
      draw();
      if (states[service].connected) await list();
      else note(states[service].configured ? `Connect ${LABEL[service]} to browse it.` : `Set ${LABEL[service]} up with your app's client ID first.`);
    } catch (err) {
      note(`The cloud is unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  dialog.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-c]");
    if (!b) return;
    const c = b.dataset.c;
    try {
      if (c === "google" || c === "dropbox") {
        service = c;
        folders = [""];
        await refresh();
      } else if (c === "setup") {
        show(".fw-cloud-setup", true);
      } else if (c === "saveApp") {
        const secret = q<HTMLInputElement>("clientSecret").value;
        await send(`/api/cloud/${service}/app`, "PUT", { clientId: q<HTMLInputElement>("clientId").value, clientSecret: secret ? secret : null, fullDrive: q<HTMLInputElement>("fullDrive").checked });
        q<HTMLInputElement>("clientSecret").value = "";
        await refresh();
      } else if (c === "connect") {
        const started = await send<{ url: string; opened: boolean; paste: boolean }>(`/api/cloud/${service}/start`, "POST", { open: true });
        if (!started.opened) window.open(started.url, "_blank", "noopener");
        show(".fw-cloud-paste", started.paste);
        note(started.paste ? "Dropbox opened in your browser: allow formwav, then paste the code it shows." : "Finish signing in to Google in your browser, then press Refresh.");
      } else if (c === "finish") {
        await send("/api/cloud/dropbox/code", "POST", { code: q<HTMLInputElement>("code").value });
        q<HTMLInputElement>("code").value = "";
        await refresh();
      } else if (c === "refresh") {
        await refresh();
      } else if (c === "disconnect") {
        await send(`/api/cloud/${service}`, "DELETE");
        await refresh();
      } else if (c === "enter") {
        folders.push(b.dataset.id ?? "");
        await list();
      } else if (c === "up") {
        folders.pop();
        await list();
      } else if (c === "more") {
        await list(true);
      } else if (c === "take") {
        b.disabled = true;
        note(`Bringing in ${b.dataset.name}...`);
        const got = await send<{ project?: string; media?: MediaRef }>(`/api/cloud/${service}/import`, "POST", { id: b.dataset.id, name: b.dataset.name });
        if (got.project) {
          dialog.close();
          host.dispatchEvent(new CustomEvent("fw-open-project", { detail: got.project }));
        } else if (got.media) {
          engine.dispatch({ type: "import-media", media: got.media, at: engine.get("transport").positionSamples });
          note(`Added ${got.media.name} on a new track at the playhead.`);
        }
        b.disabled = false;
      } else if (c === "save") {
        const name = savedSessionName();
        if (!name) {
          note("Save the session first (File > Save), so what goes up is what you saved.");
          return;
        }
        b.disabled = true;
        note(`Saving ${name} to ${LABEL[service]}...`);
        await send(`/api/cloud/${service}/upload`, "POST", { project: name });
        note(`Saved ${name}.fmw to the formwav folder in ${LABEL[service]}.`);
        b.disabled = false;
        await list();
      }
    } catch (err) {
      b.disabled = false;
      note(err instanceof Error ? err.message : String(err));
    }
  });

  host.querySelector<HTMLButtonElement>('[data-action="cloud"]')?.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    void refresh();
  });
}
