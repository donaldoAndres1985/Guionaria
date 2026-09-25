import type { MediaKind, Scene, SceneEffect } from "@/lib/api";

export const KINDS: { id: MediaKind; label: string; tone: string }[] = [
  { id: "video", label: "Video", tone: "bg-[#5aa6d6]/15 text-[#7fbde4]" },
  { id: "image", label: "Imagen", tone: "bg-[#b58be0]/15 text-[#c7a6ea]" },
  { id: "real", label: "Real", tone: "bg-active text-active-foreground" },
  { id: "text", label: "Texto", tone: "bg-[#e2b04a]/15 text-[#e8c374]" },
  { id: "black", label: "Negro", tone: "bg-panel-2 text-muted-foreground" },
];

export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<
  MediaKind,
  string
>;

export const EFFECTS: { id: SceneEffect; label: string }[] = [
  { id: "ninguno", label: "Ninguno" },
  { id: "zoom_lento_in", label: "Zoom lento (acercar)" },
  { id: "zoom_lento_out", label: "Zoom lento (alejar)" },
  { id: "ken_burns", label: "Ken Burns" },
  { id: "estatica", label: "Estática" },
  { id: "fundido_negro", label: "Fundido a negro" },
  { id: "glitch", label: "Glitch" },
  { id: "camara_rapida", label: "Cámara rápida" },
];

export const EFFECT_LABEL = Object.fromEntries(EFFECTS.map((e) => [e.id, e.label])) as Record<
  SceneEffect,
  string
>;

export type KindFilter = "all" | MediaKind;

/** Contadores para las pestañas de filtro (referencia 04). */
export function kindCounts(scenes: Scene[]): Record<KindFilter, number> {
  const counts = { all: scenes.length, video: 0, image: 0, real: 0, text: 0, black: 0 };
  for (const s of scenes) counts[s.media_kind] += 1;
  return counts;
}

export function filterScenes(scenes: Scene[], filter: KindFilter): Scene[] {
  return filter === "all" ? scenes : scenes.filter((s) => s.media_kind === filter);
}

/** 3.75 → "0:03.7". Décimas para distinguir escenas cortas de un mismo segmento. */
export function formatSceneTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const tenths = Math.floor(seconds * 10);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** La narración se muestra solo en la primera escena de cada segmento consecutivo. */
export function isFirstOfSegment(scenes: Scene[], index: number): boolean {
  return index === 0 || scenes[index - 1].seg_key !== scenes[index].seg_key;
}

export function needsReview(scene: Scene): boolean {
  return scene.status === "review" || scene.segment_missing;
}

/** Aviso cuando a una escena le falta la búsqueda que exige su tipo (sección 11.2). */
export function missingQuery(scene: Scene): string | null {
  if ((scene.media_kind === "video" || scene.media_kind === "image") && !scene.query_en) {
    return "Falta la búsqueda en inglés";
  }
  if (scene.media_kind === "real" && !scene.query_real) return "Falta la búsqueda de material real";
  return null;
}
