import type { TimelineMarker, TimelineState } from "@/lib/api";

/** Paso de la regla: 1, 2, 5, 10, 15, 30 o 60 s según la duración, para ~6–12 marcas. */
export function rulerStep(duration: number): number {
  return [1, 2, 5, 10, 15, 30, 60].find((s) => duration / s <= 12) ?? 120;
}

export function rulerTicks(duration: number): number[] {
  const step = rulerStep(duration);
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return ticks;
}

/** Posición en % del ancho del timeline. */
export const pct = (t: number, duration: number) => (duration > 0 ? (t / duration) * 100 : 0);

export const MARKER_TONE: Record<TimelineMarker["color"], string> = {
  ORANGE: "bg-brand",
  BLUE: "bg-[#5aa6d6]",
  GREEN: "bg-success-foreground",
  PURPLE: "bg-[#b58be0]",
};

export const FORMAT_FILES = [
  { format: "otio", label: "OpenTimelineIO", hint: "DaVinci Resolve: Archivo → Importar → Timeline" },
  { format: "fcpxml", label: "FCPXML 1.9", hint: "DaVinci Resolve o Final Cut Pro" },
  { format: "edl", label: "EDL CMX 3600", hint: "Respaldo para cualquier editor" },
] as const;

export function resolutionLabel(state: TimelineState): string {
  const ratio = state.width > state.height ? "16:9" : "9:16";
  return `${ratio} · ${state.width}×${state.height} · ${state.fps} fps`;
}

export const clipCount = (state: TimelineState) => state.scenes.filter((s) => s.file_name).length;

/** Fecha de exportación legible: "25/9 15:40". */
export function exportedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
