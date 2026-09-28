export interface HealthReply {
  status: string;
  name: string;
  version: string;
}

export async function fetchHealth(timeoutMs = 5000): Promise<HealthReply> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/health", { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`engine answered ${res.status}`);
    const body = (await res.json()) as HealthReply;
    if (body.name !== "formwav" || body.status !== "ok") throw new Error("unexpected health reply");
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}
