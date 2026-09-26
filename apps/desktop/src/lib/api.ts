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
  // Con FormData el navegador pone el Content-Type multipart con su "boundary".
  const isForm = init?.body instanceof FormData;
  const resp = await fetch(`${CORE_URL}${path}`, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
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
  del: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
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

export type KeyProvider = keyof ApiKeys | "searxng";

export type KeyStatus = "valid" | "invalid" | "missing" | "rate_limited" | "unreachable" | "error";

export interface KeyTestResult {
  provider: KeyProvider;
  status: KeyStatus;
  message: string;
  latency_ms: number | null;
  quota_remaining: number | null;
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

export type MediaKind = "video" | "image" | "real" | "text" | "black";
export type SceneEffect =
  | "zoom_lento_in"
  | "zoom_lento_out"
  | "ken_burns"
  | "estatica"
  | "fundido_negro"
  | "glitch"
  | "camara_rapida"
  | "ninguno";
export type SceneStatus = "pending" | "candidates" | "approved" | "manual" | "review";

export interface Scene {
  id: number;
  seg_key: string;
  position: number;
  start_s: number | null;
  end_s: number | null;
  timing_source: string;
  narration: string | null;
  media_kind: MediaKind;
  visual_description: string | null;
  query_en: string | null;
  query_alt: string | null;
  query_real: string | null;
  effect: SceneEffect | null;
  on_screen_text: string | null;
  sfx: string | null;
  music_cue: string | null;
  status: SceneStatus;
  approved_asset_id: number | null;
  sfx_sound_id?: number | null;
  music_sound_id?: number | null;
  segment_missing: boolean;
}

export type SceneUpdate = Partial<
  Pick<
    Scene,
    | "media_kind"
    | "visual_description"
    | "query_en"
    | "query_alt"
    | "query_real"
    | "effect"
    | "on_screen_text"
    | "sfx"
    | "music_cue"
  >
>;

export interface ScenesState {
  project_id: number;
  editable: boolean;
  approved: boolean;
  scenes: Scene[];
  total_s: number;
  review_count: number;
  segments_without_scenes: string[];
}

export interface Asset {
  id: number;
  kind: "image" | "video" | "audio";
  file_name: string;
  file_url: string;
  thumb_url: string | null;
  provider: string;
  provider_id: string | null;
  source_page_url: string | null;
  author: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  orientation: string | null;
  size_bytes: number | null;
  low_res: boolean;
}

export type DownloadStatus = "none" | "queued" | "downloading" | "done" | "failed" | "manual";

export interface Candidate {
  id: number;
  scene_id: number;
  provider: string;
  provider_id: string | null;
  kind: "image" | "video";
  preview_url: string | null;
  video_preview_url: string | null;
  full_url: string | null;
  page_url: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  author: string | null;
  license: string | null;
  query: string | null;
  selected: boolean;
  /** Orden en que se eligió: el 1 queda como principal al descargar. */
  selection_order?: number | null;
  download_status: DownloadStatus;
  error: string | null;
  asset: Asset | null;
}

export type FramingMode = "none" | "crop" | "blur";

export interface ApprovedMedia {
  asset: Asset;
  role: "main" | "alt";
  file_name: string;
  framing_mode: FramingMode;
  framing_pending: boolean;
  trim_in_s: number | null;
  trim_out_s: number | null;
  approved_url: string | null;
}

/** Rectángulo visible en fracciones (0–1) del ancho y alto del original. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FramingInput {
  mode: FramingMode;
  crop: Crop | null;
  trim_in_s: number | null;
  trim_out_s: number | null;
}

export interface FramingState extends FramingInput {
  scene_id: number;
  asset_id: number;
  kind: "image" | "video";
  source_width: number | null;
  source_height: number | null;
  source_duration_s: number | null;
  target_width: number;
  target_height: number;
  orientation_mismatch: boolean;
  suggested_crop: Crop | null;
  rendered: boolean;
  approved_url: string;
}

export interface SceneMedia {
  scene_id: number;
  position: number;
  seg_key: string;
  media_kind: MediaKind;
  narration: string | null;
  visual_description: string | null;
  query_en: string | null;
  query_alt: string | null;
  query_real: string | null;
  start_s: number | null;
  end_s: number | null;
  status: SceneStatus;
  needs_media: boolean;
  default_query: string | null;
  search_kind: "image" | "video" | null;
  available_providers: string[];
  default_providers: string[];
  approved: ApprovedMedia[];
  candidates: Candidate[];
}

export interface SceneMediaSummary {
  scene_id: number;
  position: number;
  media_kind: MediaKind;
  visual_description: string | null;
  status: SceneStatus;
  needs_media: boolean;
  candidate_count: number;
  downloaded_count: number;
  /** Elegidos que aún no se descargaron. */
  selected_count: number;
  approved_thumb_url: string | null;
}

export interface MediaOverview {
  project_id: number;
  orientation: "landscape" | "portrait";
  editable: boolean;
  approved: boolean;
  configured_providers: string[];
  scenes: SceneMediaSummary[];
  needing_media: number;
  with_media: number;
  /** Elegidos por descargar en todo el proyecto. */
  selected_pending: number;
}

export interface SearchResult {
  scene: SceneMedia;
  warnings: string[];
  page: number;
  has_more: boolean;
}

/** Las URLs de archivos del núcleo son relativas (/api/assets/…). */
export const coreUrl = (path: string | null | undefined) =>
  path ? (path.startsWith("/") ? `${CORE_URL}${path}` : path) : undefined;

export interface PackageResult {
  folder: string;
  files: string[];
  missing_media: number[];
}

export interface VoiceInfo {
  id: string;
  label: string;
  country: string;
  quality: string;
  speakers: number;
  size_mb: number;
  path: string;
  installed: boolean;
}

export type TimingSource = "voice" | "whisper";

export interface SegmentVoice {
  seg_key: string;
  text: string;
  start_s: number | null;
  end_s: number | null;
  audio_url: string | null;
}

export interface VoiceState {
  project_id: number;
  can_edit: boolean;
  reason: string | null;
  source: "piper" | "recorded" | null;
  voice_id: string | null;
  speed: number | null;
  duration_s: number | null;
  audio_url: string | null;
  timing_source: TimingSource | null;
  stale: boolean;
  segments: SegmentVoice[];
  word_count: number;
  subtitles: string[];
  default_voice: string;
  whisper_model: string;
}

export type TimelineFormat = "otio" | "fcpxml" | "edl";

export interface TimelineScene {
  position: number;
  kind: MediaKind;
  start_s: number;
  duration_s: number;
  clip_duration_s: number | null;
  file_name: string | null;
  thumb_url: string | null;
  text: string | null;
}

export interface TimelineMarker {
  time_s: number;
  name: string;
  note: string;
  color: "ORANGE" | "BLUE" | "GREEN" | "PURPLE";
}

export interface TimelineState {
  project_id: number;
  can_export: boolean;
  reason: string | null;
  fps: number;
  width: number;
  height: number;
  duration_s: number;
  has_voice: boolean;
  voice_duration_s: number | null;
  scenes: TimelineScene[];
  markers: TimelineMarker[];
  sfx?: TimelineSound[];
  music?: TimelineSound[];
  warnings: string[];
  folder: string;
  exports: { format: TimelineFormat; file: string; updated_at: string }[];
}

export interface TimelineExport {
  folder: string;
  files: string[];
  warnings: string[];
  state: TimelineState;
}

export interface McpInfo {
  http_url: string;
  claude_code_command: string;
  desktop_config: string;
  claude_code_available: boolean;
  claude_code_registered: boolean | null;
}

export type IdeaStatus = "open" | "converted" | "discarded";

export interface Idea {
  id: number;
  channel_id: number;
  channel_name: string;
  title: string;
  notes: string | null;
  priority: number;
  status: IdeaStatus;
  project_id: number | null;
  project_in_trash: boolean;
  created_at: string;
  updated_at: string;
}

export interface IdeaInput {
  channel_id: number;
  title: string;
  notes?: string | null;
  priority?: number;
}

export interface LibraryItem {
  asset: Asset;
  project_id: number | null;
  project_title: string | null;
  project_format: ProjectFormat | null;
  channel_id: number | null;
  channel_name: string | null;
  used_in: { scene_id: number; position: number; role: "main" | "alt" }[];
  duplicates: number;
  reused_from_id: number | null;
  created_at: string;
}

export interface Facet {
  value: string;
  count: number;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
  total_bytes: number;
  page: number;
  page_size: number;
  kinds: Facet[];
  providers: Facet[];
  orientations: Facet[];
}

export interface LibraryStats {
  assets: number;
  bytes: number;
  unique_bytes: number;
  saved_bytes: number;
  duplicate_groups: number;
}

export interface LibraryFilters {
  kind?: "image" | "video" | null;
  channel?: number | null;
  project?: number | null;
  provider?: string | null;
  orientation?: string | null;
  usage?: "approved" | "unused" | null;
  duplicates?: boolean;
  q?: string;
  sort?: "recent" | "size" | "name";
  page?: number;
  page_size?: number;
}

export interface StorageNode {
  id: string;
  name: string;
  kind: "root" | "channel" | "project" | "part" | "area";
  bytes: number;
  files: number;
  project_id: number | null;
  channel_id: number | null;
  children: StorageNode[];
}

export interface StorageUsage {
  home: string;
  tree: StorageNode;
  shared_bytes: number;
  disk_total: number;
  disk_free: number;
}

export interface CleanupProject {
  project_id: number;
  title: string;
  channel_name: string;
  status: ProjectStatus;
  media_approved: boolean;
  count: number;
  bytes: number;
}

export interface CleanupPreview {
  projects: CleanupProject[];
  total_count: number;
  total_bytes: number;
}

export type HistoryActor = "ui" | "mcp" | "system";

export interface HistoryItem {
  id: number;
  at: string;
  actor: HistoryActor;
  action: string;
  entity: string;
  text: string;
  project_id: number | null;
  project_title: string | null;
  can_restore: boolean;
}

export interface HistoryPage {
  items: HistoryItem[];
  next_before: number | null;
}

export interface TrashItem {
  project_id: number;
  title: string;
  channel_name: string;
  format: ProjectFormat;
  status: ProjectStatus;
  deleted_at: string;
  days_left: number;
  bytes: number;
}

export interface RightsRow {
  scene_position: number;
  scene_start: string;
  role: string;
  file_name: string;
  provider: string;
  origin: string;
  author: string | null;
  license: string | null;
  source_url: string | null;
  needs_review: boolean;
}

export interface RightsReport {
  project_id: number;
  rows: RightsRow[];
  review_count: number;
  credits: string;
}

export interface TimelineSound {
  name: string;
  start_s: number;
  duration_s: number;
  scene_position: number | null;
}

export type SoundKind = "sfx" | "music";

export interface Sound {
  id: number;
  kind: SoundKind;
  title: string;
  file_url: string;
  provider: string;
  source_url: string | null;
  author: string | null;
  license: string | null;
  duration_s: number | null;
  tags: string[];
  mood: string | null;
  bpm: number | null;
  size_bytes: number | null;
  used_in: number;
  created_at: string;
}

export interface FreesoundResult {
  freesound_id: number;
  title: string;
  tags: string[];
  duration_s: number;
  license: string;
  author: string;
  page_url: string;
  preview_url: string;
  saved_sound_id: number | null;
}

export interface FreesoundPage {
  results: FreesoundResult[];
  total: number;
  page: number;
  has_more: boolean;
}

export interface SceneSounds {
  scene_id: number;
  sfx: Sound | null;
  music: Sound | null;
}

export interface RenderFile {
  kind: "final" | "draft" | "thumbnail";
  name: string;
  url: string;
  size_bytes: number;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  updated_at: string;
}

export interface RenderState {
  project_id: number;
  can_render: boolean;
  reason: string | null;
  has_voice: boolean;
  has_subtitles: boolean;
  default_burn_subtitles: boolean;
  duration_s: number;
  scenes: number;
  files: RenderFile[];
}
