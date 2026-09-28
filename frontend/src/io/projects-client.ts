import type { SessionDoc } from "../engine";

export interface ProjectSummary {
  name: string;
  savedAt: string | null;
  tracks: number;
  bytes: number;
  appVersion: string | null;
}

export interface OpenedProject {
  name: string;
  savedAt: string | null;
  document: SessionDoc;
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

export async function saveProject(name: string, doc: SessionDoc): Promise<ProjectSummary> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ProjectSummary;
}

export async function openProject(name: string): Promise<OpenedProject> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as OpenedProject;
}
