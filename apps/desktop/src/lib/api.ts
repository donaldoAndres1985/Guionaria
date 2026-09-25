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
    throw new ApiError(resp.status, `${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
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
  searxng_url: string;
  whisper_model: string;
  tts_engine: string;
  tts_voice: string;
  download_parallelism: number;
  ui_language: string;
  theme: "dark" | "light";
  api_keys: ApiKeys;
}
