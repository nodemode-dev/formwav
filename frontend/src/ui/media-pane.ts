import type { Engine, MediaRef, SessionDoc } from "../engine";
import { icon as fcIcon } from "../vendor/formcut/icons";
import { patchList, setText } from "../vendor/nodemode/dom-stable";
import { mountLauncher } from "./launcher";
import { mountStepSequencer } from "./step-sequencer";

const length = (m: MediaRef) => {
  const s = m.frames / m.sampleRate;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

function fill(row: HTMLElement, m: MediaRef): void {
  setText(row.querySelector(".fw-media-name"), m.name);
  // The list reads Name, Type, Length (the approved browser): the type is the file's own extension, its channels and
  // rate are in the row's tooltip
  setText(row.querySelector(".fw-media-meta"), (/\.([a-z0-9]{1,5})$/i.exec(m.name)?.[1] ?? m.format ?? "WAV").toUpperCase());
  setText(row.querySelector(".fw-media-len"), length(m));
  const shape = `${m.channels === 1 ? "Mono" : m.channels === 2 ? "Stereo" : `${m.channels} channels`}, ${(m.sampleRate / 1000).toFixed(1)} kHz`;
  const kind = row.querySelector(".fw-media-meta");
  if (kind && kind.getAttribute("title") !== shape) kind.setAttribute("title", shape);
  const title = `${m.name} (right-click to move it to a folder)`;
  if (row.title !== title) row.title = title;
}

/** The session's audio files, as formcut's media pane lists a project's media. */
export function mountMediaPane(host: HTMLElement, engine: Engine, player?: { play(open?: boolean): Promise<void> }): void {
  const list = host.querySelector<HTMLElement>(".fw-media-list");
  const meta = host.querySelector<HTMLElement>(".fw-pane-media .fw-pane-meta");
  const end = host.querySelector<HTMLElement>(".fw-pane-media .fw-pane-end");
  if (!list) return;

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "fw-icon-btn fw-pane-action";
  importButton.setAttribute("aria-label", "Import audio");
  importButton.title = "Import any audio or video file";
  importButton.innerHTML = fcIcon("plus");
  importButton.addEventListener("click", () => host.querySelector<HTMLInputElement>(".fw-file")?.click());
  end?.append(importButton);

  const emptyText = "Audio you import or record shows up here";

  const gen = document.createElement("section");
  gen.className = "fw-insp-section fw-generate";
  gen.innerHTML = `<div class="fw-insp-head">Generate</div>
<label class="fw-field fw-field-stack"><span>Signal</span><select data-g="kind"><option value="tone">Tone</option><option value="noise-white">White noise</option><option value="noise-pink">Pink noise</option><option value="noise-brown">Brown noise</option><option value="silence">Silence</option><option value="chirp">Chirp, 100 Hz to 8 kHz</option><option value="dtmf">DTMF tones</option><option value="bleep">Bleep, 1 kHz</option></select></label>
<label class="fw-field" data-gfor="tone noise-white noise-pink noise-brown silence chirp bleep"><span>Seconds</span><input type="number" data-g="seconds" value="5" min="0.1" max="3600" step="0.1"><span></span></label>
<label class="fw-field" data-gfor="tone"><span>Hz</span><input type="number" data-g="freq" value="440" min="20" max="20000" step="1"><span></span></label>
<label class="fw-field" data-gfor="tone"><span>Wave</span><select data-g="waveform"><option value="sine">Sine</option><option value="square">Square</option><option value="sawtooth">Sawtooth</option><option value="triangle">Triangle</option></select><span></span></label>
<label class="fw-field" data-gfor="tone"><span>Level</span><input type="number" data-g="amplitude" value="0.5" min="0" max="1" step="0.05" title="Amplitude, 0 to 1 of full scale"><span></span></label>
<label class="fw-field" data-gfor="chirp"><span>From</span><input type="number" data-g="sweepFrom" value="100" min="1" max="23999" step="1"><span>Hz</span></label>
<label class="fw-field" data-gfor="chirp"><span>To</span><input type="number" data-g="sweepTo" value="8000" min="1" max="23999" step="1"><span>Hz</span></label>
<label class="fw-field" data-gfor="chirp"><span>Curve</span><select data-g="sweepCurve"><option value="linear">Linear</option><option value="log">Logarithmic</option></select><span></span></label>
<label class="fw-field" data-gfor="chirp"><span>Level</span><input type="number" data-g="sweepLevel" value="0.5" min="0" max="1" step="0.05" title="Amplitude, 0 to 1 of full scale"><span></span></label>
<label class="fw-field" data-gfor="dtmf"><span>Digits</span><input type="text" data-g="digits" value="0123456789" maxlength="64"><span></span></label>
<button type="button" class="fw-ibtn" data-g="go">Add on a new track</button>`;
  (host.querySelector<HTMLElement>(".fw-create-body") ?? list).append(gen);
  mountStepSequencer(host.querySelector<HTMLElement>(".fw-create-body") ?? list, engine, document.querySelector<HTMLElement>(".fw-notice"));
  mountLauncher(host.querySelector<HTMLElement>(".fw-create-body") ?? list, engine, document.querySelector<HTMLElement>(".fw-notice"), player);
  const lib = document.createElement("section");
  lib.className = "fw-insp-section fw-library";
  lib.innerHTML = `<div class="fw-insp-head">Library</div>
<ol class="fw-snd-list" aria-label="Library sounds"></ol>
<audio data-l="audio" preload="none" hidden></audio>
<p class="fw-empty-note fw-library-note" title="Synthesised by the engine, so free to use anywhere">Click a sound to add it on a new track</p>
<div class="fw-insp-head fw-cat-head">Recorded sounds and music</div>
<div class="fw-cat-search"><input type="search" data-c="q" placeholder="Search, e.g. rain" aria-label="Search recorded sounds and music on Wikimedia Commons"><button type="button" class="fw-ibtn" data-c="search">Search</button></div>
<ol class="fw-cat-results" aria-label="Recorded sounds and music"></ol>
<p class="fw-empty-note fw-cat-note" aria-live="polite" title="From Wikimedia Commons: public domain, CC0 and CC BY only, so free to use anywhere; each keeps its credit">Free recordings from Wikimedia</p>`;
  gen.after(lib);
  const libList = lib.querySelector<HTMLOListElement>(".fw-snd-list") as HTMLOListElement;
  const libAudio = lib.querySelector<HTMLAudioElement>('[data-l="audio"]') as HTMLAudioElement;
  const PLAY = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg>`;
  void fetch("/api/library")
    .then((r) => r.json())
    .then((items: { id: string; name: string; category: string; seconds: number }[]) => {
      let group = "";
      for (const it of items) {
        if (it.category !== group) {
          group = it.category;
          const head = document.createElement("li");
          head.className = "fw-snd-group";
          head.textContent = group;
          libList.append(head);
        }
        const [name, ...rest] = it.name.split(", ");
        const sub = rest.join(", ");
        const li = document.createElement("li");
        li.className = "fw-snd-item";
        li.innerHTML = `<button type="button" class="fw-snd-add" data-l="add"><span class="fw-snd-name"></span><span class="fw-snd-len"></span><span class="fw-snd-sub"></span></button><button type="button" class="fw-snd-play" data-l="preview">${PLAY}</button>`;
        const add = li.querySelector<HTMLButtonElement>(".fw-snd-add") as HTMLButtonElement;
        const play = li.querySelector<HTMLButtonElement>(".fw-snd-play") as HTMLButtonElement;
        add.dataset.id = it.id;
        play.dataset.id = it.id;
        add.title = `Add ${it.name} on a new track at the playhead`;
        play.title = `Preview ${it.name}`;
        play.setAttribute("aria-label", `Preview ${it.name}`);
        setText(li.querySelector(".fw-snd-name"), name);
        setText(li.querySelector(".fw-snd-sub"), sub ? sub[0].toUpperCase() + sub.slice(1) : "");
        setText(li.querySelector(".fw-snd-len"), `${Math.floor(it.seconds / 60)}:${String(Math.round(it.seconds % 60)).padStart(2, "0")}`);
        libList.append(li);
      }
    })
    .catch(() => setText(lib.querySelector(".fw-library-note"), "The library could not be listed; is the engine running?"));
  lib.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-l]");
    const id = button?.dataset.id;
    if (!button || !id) return;
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    if (button.dataset.l === "preview") {
      libAudio.src = `/api/library/${encodeURIComponent(id)}/preview.wav`;
      libAudio.play().catch(() => setText(notice, "The browser would not play the preview"));
      return;
    }
    button.disabled = true;
    try {
      const doc = engine.get("document");
      const res = await fetch(`/api/library/${encodeURIComponent(id)}?rate=${doc.tracks.length ? doc.sampleRate : 48000}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string };
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "import-media", media: body as unknown as MediaRef, at: engine.get("transport").positionSamples });
      setText(notice, `Added ${body.name} on a new track at the playhead`);
    } catch (err) {
      setText(notice, `Could not add the sound: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.disabled = false;
    }
  });
  // DS-14: recorded sound effects and music from Wikimedia Commons, royalty-free licences only, each keeping its credit
  type CatItem = { title: string; url: string; license: string; author: string; credit: string };
  const catResults = lib.querySelector<HTMLOListElement>(".fw-cat-results") as HTMLOListElement;
  const catNote = lib.querySelector<HTMLElement>(".fw-cat-note");
  let catItems: CatItem[] = [];
  const catSearch = async () => {
    const q = (lib.querySelector<HTMLInputElement>('[data-c="q"]')?.value ?? "").trim();
    if (!q) return;
    setText(catNote, `Searching for ${q}...`);
    try {
      const res = await fetch(`/api/library/catalogue/search?q=${encodeURIComponent(q)}&limit=20`);
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown; results?: CatItem[] };
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
      catItems = body.results ?? [];
      catResults.replaceChildren(
        ...catItems.map((it, i) => {
          const li = document.createElement("li");
          li.className = "fw-cat-item";
          li.title = it.credit;
          li.innerHTML = `<span class="fw-cat-title"></span><span class="fw-cat-meta"></span><button type="button" class="fw-ibtn" data-c="play" data-i="${i}">Preview</button><button type="button" class="fw-ibtn" data-c="add" data-i="${i}">Add</button>`;
          setText(li.querySelector(".fw-cat-title"), it.title);
          setText(li.querySelector(".fw-cat-meta"), `${it.license} · ${it.author}`);
          return li;
        }),
      );
      setText(catNote, catItems.length ? `${catItems.length} free ${catItems.length === 1 ? "recording" : "recordings"} for ${q}, credits kept` : `Nothing free to use found for ${q}`);
    } catch (err) {
      setText(catNote, `The catalogue could not be searched: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  lib.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches('[data-c="q"]') && e.key === "Enter") {
      e.preventDefault();
      void catSearch();
    }
  });
  lib.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-c]");
    if (!button) return;
    if (button.dataset.c === "search") return void catSearch();
    const it = catItems[Number(button.dataset.i)];
    if (!it) return;
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    if (button.dataset.c === "play") {
      libAudio.src = `/api/library/catalogue/preview?url=${encodeURIComponent(it.url)}`;
      libAudio.play().catch(() => setText(notice, "The browser would not play the preview"));
      return;
    }
    button.disabled = true;
    try {
      const doc = engine.get("document");
      const res = await fetch(`/api/library/catalogue/import?rate=${doc.tracks.length ? doc.sampleRate : 48000}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: it.url, title: it.title, credit: it.credit }) });
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "import-media", media: body as unknown as MediaRef, at: engine.get("transport").positionSamples });
      setText(notice, `Added ${it.title} on a new track; credit: ${it.credit}`);
    } catch (err) {
      setText(notice, `Could not add the recording: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.disabled = false;
    }
  });
  const g = <T extends HTMLElement>(name: string) => gen.querySelector<T>(`[data-g="${name}"]`) as T;
  const showFields = () => {
    const kind = g<HTMLSelectElement>("kind").value;
    for (const row of gen.querySelectorAll<HTMLElement>("[data-gfor]")) {
      const on = (row.dataset.gfor ?? "").split(" ").includes(kind);
      if (row.hidden === on) row.hidden = !on;
    }
  };
  gen.addEventListener("change", showFields);
  gen.addEventListener("click", async (e) => {
    if ((e.target as HTMLElement).closest<HTMLElement>("[data-g]")?.dataset.g !== "go") return;
    const button = g<HTMLButtonElement>("go");
    const doc = engine.get("document");
    const params = new URLSearchParams({
      kind: g<HTMLSelectElement>("kind").value,
      seconds: g<HTMLInputElement>("seconds").value,
      rate: String(doc.tracks.length ? doc.sampleRate : 48000),
      freq: g<HTMLInputElement>("freq").value,
      digits: g<HTMLInputElement>("digits").value,
      waveform: g<HTMLSelectElement>("waveform").value,
      amplitude: g<HTMLInputElement>("amplitude").value,
    });
    if (params.get("kind") === "chirp") {
      params.set("freq", g<HTMLInputElement>("sweepFrom").value);
      params.set("freq_end", g<HTMLInputElement>("sweepTo").value);
      params.set("curve", g<HTMLSelectElement>("sweepCurve").value);
      params.set("amplitude", g<HTMLInputElement>("sweepLevel").value);
    }
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    button.disabled = true;
    try {
      const res = await fetch(`/api/generate?${params}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
      const media = body as unknown as MediaRef;
      engine.dispatch({ type: "import-media", media, at: engine.get("transport").positionSamples });
      setText(notice, `Generated ${media.name} on a new track at the playhead`);
    } catch (err) {
      setText(notice, `Could not generate: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.disabled = false;
    }
  });
  showFields();

  type Entry = { kind: "folder"; id: string; name: string; count: number; open: boolean } | { kind: "media"; id: string; m: MediaRef };
  const closed = new Set<string>();
  const fillFolder = (row: HTMLElement, f: { name: string; count: number; open: boolean }) => {
    setText(row.querySelector(".fw-media-folder-name"), f.name);
    setText(row.querySelector(".fw-media-folder-count"), String(f.count));
    if (row.getAttribute("aria-expanded") !== String(f.open)) row.setAttribute("aria-expanded", String(f.open));
    if (row.dataset.folder !== f.name) row.dataset.folder = f.name;
  };
  const render = (doc: SessionDoc) => {
    const all = Object.values(doc.media);
    const folders = doc.mediaFolders ?? {};
    const names = [...new Set(all.map((m) => folders[m.id]).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b));
    const items: Entry[] = all.filter((m) => !folders[m.id]).map((m) => ({ kind: "media" as const, id: m.id, m }));
    for (const name of names) {
      const inside = all.filter((m) => folders[m.id] === name);
      items.push({ kind: "folder", id: `folder:${name}`, name, count: inside.length, open: !closed.has(name) });
      if (!closed.has(name)) items.push(...inside.map((m) => ({ kind: "media" as const, id: m.id, m })));
    }
    const placeholder = all.length ? "" : emptyText;
    if (list.dataset.empty !== placeholder) list.dataset.empty = placeholder;
    setText(meta, all.length ? `${all.length} file${all.length === 1 ? "" : "s"}` : "");
    patchList(list, items, {
      key: (e) => e.id,
      create: (e) => {
        if (e.kind === "folder") {
          const head = document.createElement("button");
          head.type = "button";
          head.className = "fw-media-folder";
          head.title = "Click to fold or open; drop media here to move it into this folder";
          head.innerHTML = `${fcIcon("chevD")}<span class="fw-media-folder-name"></span><span class="fw-media-folder-count"></span>`;
          fillFolder(head, e);
          return head;
        }
        const m = e.m;
        const row = document.createElement("div");
        row.className = "fw-media-item";
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.draggable = true;
        row.innerHTML = `<span class="fw-media-name"></span><span class="fw-media-meta" translate="no"></span><span class="fw-media-len"></span><button type="button" class="fw-icon-btn fw-media-place" aria-label="Place on the selected track" title="Place on the selected clip's track at the playhead">${fcIcon("plus")}</button><button type="button" class="fw-icon-btn fw-media-add" aria-label="Add to a new track" title="Add to a new track at the playhead">${fcIcon("addToTrack")}</button>`;
        fill(row, m);
        return row;
      },
      update: (row, e) => (e.kind === "folder" ? fillFolder(row, e) : fill(row, e.m)),
    });
  };
  const DRAG = "application/x-formwav-media";
  list.addEventListener("click", (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>(".fw-media-folder");
    const name = head?.dataset.folder;
    if (!name) return;
    if (closed.has(name)) closed.delete(name);
    else closed.add(name);
    render(engine.get("document"));
  });
  list.addEventListener("dragover", (e) => {
    if (!(e.target as HTMLElement).closest(".fw-media-folder") || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes(DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  list.addEventListener("drop", (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>(".fw-media-folder")?.dataset.folder;
    const id = e.dataTransfer?.getData(DRAG);
    if (!name || !id) return;
    e.preventDefault();
    engine.dispatch({ type: "set-media-folder", mediaIds: [id], folder: name });
  });
  list.addEventListener("contextmenu", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".fw-media-item")?.dataset.key;
    const doc = engine.get("document");
    const media = id ? doc.media[id] : undefined;
    if (!media) return;
    e.preventDefault();
    const names = [...new Set(Object.values(doc.mediaFolders ?? {}))].sort((a, b) => a.localeCompare(b));
    const field = { key: "folder", label: "Folder", value: doc.mediaFolders?.[media.id] ?? "", text: true, placeholder: names.length ? names.join(", ") : "Dialogue, Music, Effects" };
    host.dispatchEvent(
      new CustomEvent("fw-ask", {
        detail: {
          title: "Move to a folder",
          note: `The folder ${media.name} is listed under in the media pane. Leave it empty to take it out of its folder.`,
          fields: [field],
          ok: "Move",
          done: (v: Record<string, unknown> | null) => {
            if (v) engine.dispatch({ type: "set-media-folder", mediaIds: [media.id], folder: String(v.folder ?? "").trim() || null });
          },
        },
      }),
    );
  });

  // The selected clips (from the lanes' fw-selection events): placing media uses the first one's track.
  let selectedIds: string[] = [];
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  host.addEventListener("fw-selection", (e) => {
    selectedIds = (e as CustomEvent<string[]>).detail ?? [];
  });

  list.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const id = target.closest(".fw-media-add, .fw-media-place")?.closest<HTMLElement>(".fw-media-item")?.dataset.key;
    const doc = engine.get("document");
    const media = id ? doc.media[id] : undefined;
    if (!media) return;
    const at = engine.get("transport").positionSamples;
    if (target.closest(".fw-media-place")) {
      // add-clip: this media on an existing track (imports always made a new one); lengths in session samples.
      const track = doc.tracks.find((t) => t.clips.some((c) => selectedIds.includes(c.id)));
      if (!track) {
        setText(notice, "Select a clip on the track to place this on");
        return;
      }
      const length = Math.round((media.frames * doc.sampleRate) / media.sampleRate);
      engine.dispatch({ type: "add-clip", trackId: track.id, mediaId: media.id, start: at, sourceIn: 0, length });
      setText(notice, `Placed ${media.name} on ${track.name}`);
      return;
    }
    engine.dispatch({ type: "import-media", media, at });
  });

  engine.subscribe("document", render);
  render(engine.get("document"));
}
