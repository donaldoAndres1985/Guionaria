/** Tramo de un video (segundos) para el editor «Ajustar tramo». */
export interface TrimRange {
  start: number;
  end: number;
}

export const MIN_TRIM_S = 0.5;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Tramo inicial: el guardado si existe; si no, desde el inicio y tan largo como la escena
 * (o el clip entero si es más corto).
 */
export function initialRange(
  duration: number,
  sceneDuration: number | null,
  trimIn: number | null,
  trimOut: number | null,
): TrimRange {
  if (trimIn != null || trimOut != null) {
    return { start: round(trimIn ?? 0), end: round(Math.min(trimOut ?? duration, duration)) };
  }
  const length = Math.min(sceneDuration ?? duration, duration);
  return { start: 0, end: round(length) };
}

/** Desplaza el tramo sin cambiar su largo ni salirse del clip. */
export function moveRange(range: TrimRange, delta: number, duration: number): TrimRange {
  const length = range.end - range.start;
  const start = clamp(range.start + delta, 0, duration - length);
  return { start: round(start), end: round(start + length) };
}

/** Centra el tramo en el instante t (clic en la tira). */
export function centerRangeAt(range: TrimRange, t: number, duration: number): TrimRange {
  const length = range.end - range.start;
  return moveRange({ start: t - length / 2, end: t + length / 2 }, 0, duration);
}

export function resizeStart(range: TrimRange, t: number): TrimRange {
  return { ...range, start: round(clamp(t, 0, range.end - MIN_TRIM_S)) };
}

export function resizeEnd(range: TrimRange, t: number, duration: number): TrimRange {
  return { ...range, end: round(clamp(t, range.start + MIN_TRIM_S, duration)) };
}

/** Mantiene el inicio y ajusta el largo al de la escena. */
export function fitToScene(range: TrimRange, sceneDuration: number, duration: number): TrimRange {
  const length = Math.min(sceneDuration, duration);
  return moveRange({ start: range.start, end: range.start + length }, 0, duration);
}

/** Valores a guardar: el clip entero se guarda como «sin tramo». */
export function trimToSave(range: TrimRange, duration: number): { trim_in_s: number | null; trim_out_s: number | null } {
  const whole = range.start <= 0.01 && range.end >= duration - 0.01;
  if (whole) return { trim_in_s: null, trim_out_s: null };
  return { trim_in_s: range.start > 0.01 ? range.start : null, trim_out_s: range.end < duration - 0.01 ? range.end : null };
}

export const toPct = (t: number, duration: number) => (duration > 0 ? (t / duration) * 100 : 0);

/**
 * Metraje que sobra después del tramo que usa esta escena (desde `start` y durante
 * `sceneDuration`, sin importar dónde el usuario haya puesto el fin del tramo): lo que podría
 * pasar a la escena siguiente con «Continuar en la escena siguiente».
 */
export function remainingAfterScene(duration: number, sceneDuration: number, start: number): number {
  return round(Math.max(duration - (start + sceneDuration), 0));
}
