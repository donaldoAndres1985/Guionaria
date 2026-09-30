import type { ApprovedMedia, Crop } from "@/lib/api";
import { formatSceneTime } from "@/features/scenes/sceneMeta";

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Recorte de tamaño `scale` (0–1) respecto al máximo, centrado en (cx, cy) y dentro del medio. */
export function scaledCrop(max: Crop, scale: number, cx: number, cy: number): Crop {
  const w = max.w * scale;
  const h = max.h * scale;
  return {
    x: round(clamp(cx - w / 2, 0, 1 - w)),
    y: round(clamp(cy - h / 2, 0, 1 - h)),
    w: round(w),
    h: round(h),
  };
}

/** Mueve el recorte (en fracciones) sin salirse del medio. */
export function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  return {
    ...crop,
    x: round(clamp(crop.x + dx, 0, 1 - crop.w)),
    y: round(clamp(crop.y + dy, 0, 1 - crop.h)),
  };
}

export const cropScale = (crop: Crop, max: Crop) => crop.w / max.w;
export const cropCenter = (crop: Crop) => ({ cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 });

export type Corner = "tl" | "tr" | "bl" | "br";
const MIN_CROP_W = 0.08;

/**
 * Redimensiona arrastrando una esquina: la esquina opuesta queda fija y el recorte mantiene
 * la proporción de `max` (la del formato de destino), como exige el encuadre "Recortar".
 */
export function resizeCorner(crop: Crop, max: Crop, corner: Corner, dx: number, dy: number): Crop {
  const aspect = max.w / max.h;
  const left = corner.includes("l");
  const top = corner.includes("t");
  const anchor = { x: left ? crop.x + crop.w : crop.x, y: top ? crop.y + crop.h : crop.y };
  const moving = {
    x: clamp((left ? crop.x : crop.x + crop.w) + dx, 0, 1),
    y: clamp((top ? crop.y : crop.y + crop.h) + dy, 0, 1),
  };

  let w = Math.abs(moving.x - anchor.x);
  let h = w / aspect;
  const maxH = top ? anchor.y : 1 - anchor.y;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  const maxW = left ? anchor.x : 1 - anchor.x;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }
  w = Math.max(w, MIN_CROP_W);
  h = Math.max(h, MIN_CROP_W / aspect);

  return {
    x: round(clamp(left ? anchor.x - w : anchor.x, 0, 1 - w)),
    y: round(clamp(top ? anchor.y - h : anchor.y, 0, 1 - h)),
    w: round(w),
    h: round(h),
  };
}

/** Etiqueta corta del encuadre de un aprobado. */
export function framingLabel(a: ApprovedMedia): string | null {
  if (a.framing_pending) return "Generando el video encuadrado…";
  const parts = [];
  if (a.framing_mode === "crop") parts.push("Recortado");
  if (a.framing_mode === "blur") parts.push("Fondo desenfocado");
  if (a.trim_in_s != null || a.trim_out_s != null) {
    parts.push(`Tramo ${formatSceneTime(a.trim_in_s ?? 0)}–${a.trim_out_s != null ? formatSceneTime(a.trim_out_s) : "fin"}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Valida el tramo; devuelve el mensaje de error o null. */
export function trimError(start: number | null, end: number | null, duration: number | null): string | null {
  if (Number.isNaN(start) || Number.isNaN(end)) return "Usa minutos:segundos, por ejemplo 0:02.5";
  const s = start ?? 0;
  const e = end ?? duration;
  if (duration != null && end != null && end > duration + 0.05) return `El video dura ${formatSceneTime(duration)}`;
  if (e != null && e - s < 0.5) return "El tramo debe durar al menos 0,5 s";
  return null;
}
