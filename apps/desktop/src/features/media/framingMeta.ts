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
