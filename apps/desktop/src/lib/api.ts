/** Cliente HTTP del núcleo local (guionaria-core, solo localhost). */

export const CORE_URL = "http://127.0.0.1:8765";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${CORE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!resp.ok) {
    throw new ApiError(resp.status, await errorMessage(resp));
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

/** FastAPI devuelve {"detail": "..."} o, en validaciones, {"detail": [{msg, loc}]}. */
async function errorMessage(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) {
      const field = body.detail[0].loc?.at(-1);
      return field ? `${field}: ${body.detail[0].msg}` : body.detail[0].msg;
    }
  } catch {
    // respuesta sin JSON
  }
  return `${resp.status} ${resp.statusText}`;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, json("POST", body)),
  put: <T>(path: string, body: unknown) => request<T>(path, json("PUT", body)),
  patch: <T>(path: string, body: unknown) => request<T>(path, json("PATCH", body)),
  del: (path: string) => request<void>(path, { method: "DELETE" }),
};

export interface DependencyStatus {
  name: string;
  label: string;
  ok: boolean;
  required: boolean;
  version: string | null;
  path: string | null;
  detail: string | null;
  install_hint: string;
}

export interface Health {
  status: "ok" | "degraded";
  version: string;
  home: string;
  db_ok: boolean;
  dependencies: DependencyStatus[];
}

export interface ApiKeys {
  pexels: string;
  pixabay: string;
  unsplash: string;
  freesound: string;
}

export interface AppSettings {
  claude_model: string;
  searxng_url: string;
  whisper_model: string;
  tts_engine: string;
  tts_voice: string;
  download_parallelism: number;
  ui_language: string;
  theme: "dark" | "light";
  api_keys: ApiKeys;
}

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook";

export interface ChannelInput {
  name: string;
  platforms: Platform[];
  language: string;
  niche: string | null;
  style_prompt: string | null;
  script_template: string | null;
  words_per_second: number;
  default_voice: string | null;
}

export interface Channel extends ChannelInput {
  id: number;
  slug: string;
  project_count: number;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus =
  | "IDEA"
  | "GUION_BORRADOR"
  | "GUION_APROBADO"
  | "ESCENAS_BORRADOR"
  | "ESCENAS_APROBADAS"
  | "MEDIOS_EN_REVISION"
  | "MEDIOS_APROBADOS"
  | "VOZ_LISTA"
  | "TIMELINE_LISTO"
  | "RENDERIZADO"
  | "PROGRAMADO"
  | "PUBLICADO";

export type ProjectFormat = "video" | "reel";

export interface ProjectInput {
  channel_id: number;
  title: string;
  format: ProjectFormat;
  topic: string | null;
  research_notes: string | null;
  target_duration_s: number | null;
  target_publish_at: string | null;
  priority: number;
  tags: string[];
}

export type ProjectUpdate = Partial<Omit<ProjectInput, "channel_id" | "format">>;

export interface Project extends ProjectInput {
  id: number;
  channel_name: string;
  channel_slug: string;
  slug: string;
  status: ProjectStatus;
  folder_path: string;
  parent_project_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentInput {
  seg_key: string | null;
  section: string | null;
  text: string;
  needs_fact_check: boolean;
}

export interface ScriptSegment {
  seg_key: string;
  position: number;
  section: string | null;
  text: string;
  est_duration_s: number;
  needs_fact_check: boolean;
}

export interface Script {
  project_id: number;
  version: number;
  status: "draft" | "approved" | "superseded";
  source: string | null;
  created_at: string;
  segments: ScriptSegment[];
  word_count: number;
  total_est_s: number;
  target_duration_s: number | null;
  words_per_second: number;
  sections: string[];
}

export interface ScriptVersionSummary {
  version: number;
  status: Script["status"];
  source: string | null;
  created_at: string;
  segment_count: number;
  word_count: number;
  total_est_s: number;
}

export interface RewriteResult {
  seg_key: string;
  fragmento: string;
  texto: string;
  verificar_dato: boolean;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: number;
  type: string;
  project_id: number | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Prompt {
  name: string;
  label: string;
  content: string;
  is_default: boolean;
}
