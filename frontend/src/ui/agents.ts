/**
 * Settings > Agents (PLAN_v11 3.2, routers/agents.py; formcut's Settings, Connections the model): connecting an AI agent
 * to formwav's MCP server. Each client shows where its configuration goes, whether formwav is in it already, the exact
 * text to paste (Copy), and, for Claude Code, Codex, Cursor and Claude Desktop, Add: formwav merged into the client's
 * own configuration beside everything else in it, the previous file kept as a backup. The formwav-harness skill in
 * .claude/skills teaches the agent to use the tools; the dialog says so.
 */
import { setText } from "../vendor/nodemode/dom-stable";

type Client = { id: string; name: string; kind: "command" | "file"; file: string | null; text: string; installable: boolean; present: boolean | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function mountAgents(host: HTMLElement): void {
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog fw-agents-dialog";
  dialog.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Agents</h2>
  <p class="fw-agents-note">An agent reaches formwav through its MCP server: 28 tools for media, repair, speech, music, dubbing, recording, sessions and the cloud. The formwav-harness skill in this repository's .claude/skills teaches it to use them well. Add formwav to a client here, or copy its text into the client yourself; formwav must be running when the agent calls it.</p>
  <div class="fw-agents-list" data-a="list"><p class="fw-agents-note">Reading the clients...</p></div>
  <output class="fw-agents-state" data-a="state"></output>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="close">Close</button></div>
</form>`;
  document.body.append(dialog);
  const list = dialog.querySelector<HTMLElement>('[data-a="list"]') as HTMLElement;
  const state = dialog.querySelector<HTMLElement>('[data-a="state"]');
  let clients: Client[] = [];

  const draw = () => {
    list.innerHTML = clients
      .map((c) => `<section class="fw-agent-client" data-client="${c.id}">
  <div class="fw-agent-head"><strong>${esc(c.name)}</strong><span class="fw-agent-where">${c.kind === "file" ? esc(c.file ?? "") : "a command to run"}</span><span class="fw-agent-present" data-present>${c.present ? "formwav added" : ""}</span></div>
  <pre class="fw-agent-text">${esc(c.text)}</pre>
  <div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-copy="${c.id}">Copy</button>${c.installable ? `<button type="button" class="fw-ibtn" data-add="${c.id}">${c.present ? "Add again" : `Add to ${esc(c.name)}`}</button>` : ""}</div>
</section>`)
      .join("");
  };
  const load = async () => {
    try {
      const res = await fetch("/api/agents/connect");
      const out = await res.json();
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      clients = out.clients as Client[];
      draw();
      if (!out.ready) setText(state, "Claude Code connects to the open session over HTTP; the other clients need formwav's MCP server, which is installed with formwav_oc_install in a source copy");
    } catch (err) {
      setText(state, `Could not read the clients: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  dialog.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const copy = t.closest<HTMLElement>("[data-copy]")?.dataset.copy;
    if (copy) {
      const c = clients.find((x) => x.id === copy);
      if (!c) return;
      try {
        await navigator.clipboard.writeText(c.text);
        setText(state, `Copied ${c.name}'s text`);
      } catch {
        const pre = dialog.querySelector<HTMLElement>(`[data-client="${copy}"] .fw-agent-text`);
        if (pre) window.getSelection()?.selectAllChildren(pre);
        setText(state, `Selected ${c.name}'s text: copy it with the keyboard`);
      }
      return;
    }
    const add = t.closest<HTMLButtonElement>("[data-add]");
    if (!add) return;
    const c = clients.find((x) => x.id === add.dataset.add);
    if (!c) return;
    add.disabled = true;
    try {
      const res = await fetch("/api/agents/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: c.id }) });
      const out = await res.json();
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      setText(state, `Added formwav to ${c.name} (${out.written})${out.backup ? `; your previous file is kept as ${out.backup}` : ""}. Restart ${c.name} to see its tools.`);
      await load();
    } catch (err) {
      setText(state, `Could not add formwav to ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      add.disabled = false;
    }
  });

  const item = document.createElement("button");
  item.className = "fw-ibtn";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.dataset.action = "agents";
  item.title = "Connect an AI agent (Claude Code, Codex, Cursor, Claude Desktop) to formwav's MCP server";
  item.innerHTML = "<span>Agents</span>";
  host.querySelector('.fw-settings-pop [data-action="devices"]')?.after(item);
  item.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    setText(state, "");
    void load();
  });
}
