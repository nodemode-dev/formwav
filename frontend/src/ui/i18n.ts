type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;
type Table = Record<string, Entry>;

export const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["es", "Español"],
  ["es-MX", "Español (México)"],
  ["pt-BR", "Português (Brasil)"],
  ["fr", "Français"],
  ["fr-CA", "Français (Canada)"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["nl", "Nederlands"],
  ["da", "Dansk"],
  ["fi", "Suomi"],
  ["nb", "Norsk bokmål"],
  ["sv", "Svenska"],
  ["ru", "Русский"],
  ["pl", "Polski"],
  ["cs", "Čeština"],
  ["hu", "Magyar"],
  ["uk", "Українська"],
  ["tr", "Türkçe"],
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["id", "Bahasa Indonesia"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
];

const STORE = "formwav.lang";
const ATTRS = ["title", "aria-label", "placeholder", "data-empty", "data-label"];
const SKIP = '[translate="no"], [contenteditable="true"], .xterm, script, style, .fw-agent-log > *';
const NUM = /-?\d+(?:[.,]\d+)?/g;
const FILE = /[^\s"'()]+\.(?:wav|mp3|flac|aiff?|ogg|opus|m4a|mp4|mov|webm|fmw|otioz|aaf|json|mid|midi|musicxml|txt|srt|vtt)\b/gi;
const SEPARATORS = [" · ", ": ", "; ", " (", ", "];
const LETTERS = /\p{L}{2}/u;
const PATH = /^\S*[/\\]\S*$/;
const tables = import.meta.glob<Table>("../i18n/*.json", { import: "default" });

let lang = "en";
let table: Table = {};
let plural = new Intl.PluralRules("en");
let names: () => string[] = () => [];
const english = new WeakMap<Text, string>();
const written = new WeakMap<Text, string>();
const englishAttr = new WeakMap<Element, Map<string, string>>();
const writtenAttr = new WeakMap<Element, Map<string, string>>();
const seen = new Set<string>();
const listeners = new Set<(code: string) => void>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const letter = (i: number) => String.fromCharCode(97 + i);

function pick(entry: Entry | undefined, count: string | undefined): string | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;
  const n = Number(String(count ?? "").replace(",", "."));
  return entry[Number.isFinite(n) ? plural.select(n) : "other"] ?? entry.other ?? Object.values(entry)[0];
}

function fill(text: string, nums: string[], named: string[]): string {
  return text.replace(/\{(\d+|[a-z])\}/g, (m, k: string) => (/\d/.test(k) ? nums[Number(k)] : named[k.charCodeAt(0) - 97]) ?? m);
}

/** The table key for a string: its numbers as {0}, {1}, and the session's names and file names as {a}, {b}. */
export function keyOf(text: string): { key: string; nums: string[]; named: string[] } {
  const named: string[] = [];
  let key = text.replace(/\s+/g, " ").trim();
  const known = names().filter((n) => n && n.trim().length > 1).sort((a, b) => b.length - a.length);
  for (const n of known) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(n.trim())}(?![\\p{L}\\p{N}])`, "gu");
    if (re.test(key)) key = key.replace(re, () => `{${letter(named.push(n.trim()) - 1)}}`);
  }
  key = key.replace(FILE, (m) => `{${letter(named.push(m) - 1)}}`);
  const nums: string[] = [];
  key = key.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
  return { key, nums, named };
}

function lookup(norm: string, depth = 0): string | null {
  if (!LETTERS.test(norm) || PATH.test(norm)) return norm;
  const exact = pick(table[norm], undefined);
  if (exact !== undefined) return exact;
  const { key, nums, named } = keyOf(norm);
  if (!LETTERS.test(key.replace(/\{[0-9a-z]\}/g, ""))) return norm;
  const templated = pick(table[key], nums[0]);
  if (templated !== undefined) return fill(templated, nums, named);
  if (depth < 3) {
    for (const sep of SEPARATORS) {
      const at = norm.indexOf(sep);
      if (at <= 0) continue;
      const head = lookup(norm.slice(0, at), depth + 1);
      const tail = lookup(norm.slice(at + sep.length), depth + 1);
      if (head !== null && tail !== null) return head + sep + tail;
    }
  }
  return null;
}

export function t(text: string): string {
  if (lang === "en") return text;
  const norm = text.replace(/\s+/g, " ").trim();
  const out = lookup(norm);
  if (out === null) {
    seen.add(keyOf(norm).key);
    return text;
  }
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  return lead + out + trail;
}

function skipped(el: Element | null): boolean {
  return !el || !!el.closest(SKIP);
}

function doText(node: Text): void {
  if (skipped(node.parentElement)) return;
  if (written.get(node) !== node.data) english.set(node, node.data);
  const source = english.get(node) ?? node.data;
  const out = t(source);
  if (out !== node.data) {
    written.set(node, out);
    node.data = out;
  } else written.set(node, node.data);
}

function doAttr(el: Element, name: string): void {
  if (!el.hasAttribute(name) || skipped(el)) return;
  const value = el.getAttribute(name) ?? "";
  const wrote = writtenAttr.get(el) ?? new Map<string, string>();
  const src = englishAttr.get(el) ?? new Map<string, string>();
  if (wrote.get(name) !== value) src.set(name, value);
  const out = t(src.get(name) ?? value);
  wrote.set(name, out);
  englishAttr.set(el, src);
  writtenAttr.set(el, wrote);
  if (out !== value) el.setAttribute(name, out);
}

function walk(root: Node): void {
  if (root instanceof Text) return doText(root);
  if (!(root instanceof Element)) return;
  for (const a of ATTRS) doAttr(root, a);
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = texts.nextNode(); n; n = texts.nextNode()) doText(n as Text);
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) for (const a of ATTRS) doAttr(el, a);
}

const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "childList") r.addedNodes.forEach(walk);
    else if (r.type === "characterData" && r.target instanceof Text) doText(r.target);
    else if (r.type === "attributes" && r.target instanceof Element && r.attributeName) doAttr(r.target, r.attributeName);
  }
});

function chosen(): string {
  try {
    const kept = localStorage.getItem(STORE);
    if (kept && LANGUAGES.some(([c]) => c === kept)) return kept;
  } catch {
    return "en";
  }
  return "en";
}

export function language(): string {
  return lang;
}

export function onLanguage(fn: (code: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function setLanguage(code: string): Promise<void> {
  const next = LANGUAGES.some(([c]) => c === code) ? code : "en";
  const load = tables[`../i18n/${next}.json`];
  table = next === "en" || !load ? {} : await load();
  lang = next;
  plural = new Intl.PluralRules(next);
  seen.clear();
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORE, next);
  } catch {
    /* kept for this window only */
  }
  walk(document.body);
  for (const fn of listeners) fn(next);
}

/** Starts translating before the interface mounts; the returned promise settles once the chosen table is in. */
export function startI18n(sessionNames: () => string[]): Promise<void> {
  names = sessionNames;
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const code = chosen();
  return code === "en" ? Promise.resolve() : setLanguage(code).catch(() => undefined);
}

export function mountLanguage(host: HTMLElement): void {
  const pop = host.querySelector<HTMLElement>(".fw-settings-pop");
  if (!pop) return;
  const row = document.createElement("label");
  row.className = "fw-theme-pick fw-lang-pick";
  row.title = "The language of the interface; English is the default";
  row.append("Language ");
  const pick = document.createElement("select");
  pick.setAttribute("translate", "no");
  pick.setAttribute("aria-label", "Language");
  pick.append(...LANGUAGES.map(([code, name]) => new Option(name, code)));
  pick.value = lang;
  row.append(pick);
  pop.prepend(row);
  pick.addEventListener("change", () => void setLanguage(pick.value));
  onLanguage((code) => {
    if (pick.value !== code) pick.value = code;
  });
}

/** Every string in the window now that the current table lacks (the coverage check), and every key on screen. */
function missing(): string[] {
  seen.clear();
  walk(document.body);
  return [...seen].sort();
}

function keys(): string[] {
  const out = new Set<string>();
  const add = (s: string | null) => {
    const { key } = keyOf(s ?? "");
    if (LETTERS.test(key.replace(/\{[0-9a-z]\}/g, "")) && !PATH.test(key)) out.add(key);
  };
  const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = texts.nextNode(); n; n = texts.nextNode()) if (!skipped(n.parentElement)) add(english.get(n as Text) ?? (n as Text).data);
  for (const el of document.body.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) if (!skipped(el)) for (const a of ATTRS) if (el.hasAttribute(a)) add(englishAttr.get(el)?.get(a) ?? el.getAttribute(a));
  return [...out].sort();
}

Object.assign(window, { __fwI18n: { missing, keys, setLanguage, language } });
