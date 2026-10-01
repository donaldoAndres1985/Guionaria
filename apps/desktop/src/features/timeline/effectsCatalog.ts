import type { SceneEffect } from "@/lib/api";
import { EFFECT_LABEL } from "@/features/scenes/sceneMeta";

export type EffectCategory = "motion" | "color" | "light" | "frame" | "speed";

export const EFFECT_CATEGORIES: { id: EffectCategory; label: string }[] = [
  { id: "motion", label: "Movimiento" },
  { id: "color", label: "Color y textura" },
  { id: "light", label: "Luz y fundidos" },
  { id: "frame", label: "Encuadre" },
  { id: "speed", label: "Velocidad" },
];

export interface EffectInfo {
  id: SceneEffect;
  label: string;
  category: EffectCategory;
  hint: string;
  /** Solo tiene sentido en videos (cambia la velocidad del metraje). */
  videoOnly?: boolean;
}

const info = (id: SceneEffect, category: EffectCategory, hint: string, videoOnly = false): EffectInfo => ({
  id,
  label: EFFECT_LABEL[id],
  category,
  hint,
  videoOnly,
});

/** Efectos de escena que se pueden poner desde el timeline (los mismos del render). */
export const EFFECT_CATALOG: EffectInfo[] = [
  info("zoom_lento_in", "motion", "Se acerca despacio durante toda la escena"),
  info("zoom_lento_out", "motion", "Se aleja despacio durante toda la escena"),
  info("ken_burns", "motion", "Paneo lateral hacia la derecha con un leve acercamiento"),
  info("paneo_izquierda", "motion", "Paneo lateral hacia la izquierda"),
  info("paneo_vertical", "motion", "Recorre la imagen de abajo hacia arriba"),
  info("deriva_suave", "motion", "Acercamiento en diagonal con aceleración suave"),
  info("zoom_rapido", "motion", "Golpe de cámara: se acerca rápido al empezar"),
  info("temblor", "motion", "Leve vaivén, como una cámara en mano"),
  info("blanco_negro", "color", "Sin color"),
  info("sepia", "color", "Tono de foto antigua"),
  info("contraste_alto", "color", "Más contraste y color: dramático"),
  info("vhs", "color", "Cinta antigua: color corrido y ruido"),
  info("estatica", "color", "Grano y color apagado"),
  info("glitch", "color", "Color desplazado y ruido digital"),
  info("fundido_entrada", "light", "Aparece desde negro al empezar"),
  info("fundido_negro", "light", "Se funde a negro al terminar"),
  info("destello", "light", "Entra con un destello blanco"),
  info("zoom_divino", "light", "Acercamiento con brillo difuso (celestial)"),
  info("vineta", "frame", "Bordes oscuros que centran la mirada"),
  info("cinematico", "frame", "Franjas negras arriba y abajo"),
  info("camara_rapida", "speed", "El video va al doble de velocidad", true),
  info("camara_lenta", "speed", "El video va a la mitad de velocidad", true),
];

export const effectLabel = (id: string | null | undefined) =>
  id && id !== "ninguno" ? (EFFECT_LABEL[id as SceneEffect] ?? id) : "Sin efecto";
