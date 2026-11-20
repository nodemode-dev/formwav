export const WINDOW_KEY_HEADER = "X-Formwav-Window-Key";
const STORE = "formwav-window-key";

let key = "";

function remembered(): string {
  try {
    return sessionStorage.getItem(STORE) ?? "";
  } catch {
    return "";
  }
}

function remember(value: string): void {
  try {
    sessionStorage.setItem(STORE, value);
  } catch {
    return;
  }
}

async function holds(raw: typeof fetch, value: string): Promise<boolean> {
  try {
    const res = await raw("/api/window/ticket", { method: "POST", headers: { "x-formwav-local": "1", [WINDOW_KEY_HEADER]: value } });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadWindowKey(raw: typeof fetch): Promise<void> {
  const holder = window as unknown as { __FORMWAV_WINDOW_KEY?: unknown };
  const given = holder.__FORMWAV_WINDOW_KEY;
  delete holder.__FORMWAV_WINDOW_KEY;
  if (typeof given === "string" && given) {
    key = given;
    return;
  }
  const kept = remembered();
  if (kept && (await holds(raw, kept))) {
    key = kept;
    return;
  }
  try {
    const res = await raw("/api/window/key", { method: "POST", headers: { "x-formwav-local": "1" } });
    const body = res.ok ? ((await res.json()) as { key?: unknown }) : {};
    if (typeof body.key === "string" && body.key) {
      key = body.key;
      remember(key);
    }
  } catch {
    key = "";
  }
}

export const windowKey = (): string => key;

export async function streamTicket(): Promise<string> {
  try {
    const res = await fetch("/api/window/ticket", { method: "POST" });
    if (!res.ok) return "";
    const body = (await res.json()) as { ticket?: unknown };
    return typeof body.ticket === "string" ? body.ticket : "";
  } catch {
    return "";
  }
}
