import type { SessionDoc } from "../engine";

export interface ProjectSummary {
  name: string;
  savedAt: string | null;
  tracks: number;
  bytes: number;
  appVersion: string | null;
  revision: number;
  thumbnail?: boolean;
}

export interface OpenedProject {
  name: string;
  savedAt: string | null;
  revision: number;
  document: SessionDoc;
}

export class RevisionConflict extends Error {
  constructor(
    message: string,
    readonly revision: number,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  return new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ProjectSummary[];
}

export async function saveProject(name: string, doc: SessionDoc, base: number | null): Promise<ProjectSummary> {
  const query = base === null ? "" : `?base=${base}`;
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { detail?: { message?: string; revision?: number } };
    throw new RevisionConflict(body.detail?.message ?? "the session changed elsewhere", Number(body.detail?.revision ?? 0));
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ProjectSummary;
}

/** PLAN_v13 S12: the demo session the engine makes in code, at `rate`. */
export async function openDemo(rate: number): Promise<{ name: string; document: OpenedProject["document"] }> {
  const res = await fetch(`/api/projects/demo?rate=${rate}`, { method: "POST" });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as { name: string; document: OpenedProject["document"] };
}

export async function openProject(name: string): Promise<OpenedProject> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as OpenedProject;
}
