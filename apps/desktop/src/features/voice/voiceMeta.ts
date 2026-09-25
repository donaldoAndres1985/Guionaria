import type { SegmentVoice, VoiceState } from "@/lib/api";

export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
export const PAUSES = [0, 0.15, 0.3, 0.5, 0.8];

export const speedLabel = (speed: number) => (speed === 1 ? "Normal" : `${speed.toFixed(1)}×`);

/** De dónde salen los tiempos de las escenas. */
export function timingLabel(state: VoiceState | undefined): string {
  if (!state?.source) return "Estimados";
  if (state.stale) return "Estimados (voz desactualizada)";
  if (state.timing_source === "voice") return "Reales · voz generada";
  if (state.timing_source === "whisper") return "Reales · Whisper";
  return "Estimados (falta transcribir)";
}

export const sourceLabel = (source: VoiceState["source"]) =>
  source === "piper" ? "Voz generada con Piper" : source === "recorded" ? "Voz grabada" : "Sin voz";

/** Segmento que suena en el instante t (para resaltarlo en la lista). */
export function segmentAt(segments: SegmentVoice[], t: number): string | null {
  const hit = segments.find((s) => s.start_s != null && s.end_s != null && t >= s.start_s && t < s.end_s);
  return hit?.seg_key ?? null;
}

/** Qué hace el botón principal según el estado de la voz. */
export function primaryAction(state: VoiceState | undefined): "generate" | "transcribe" | "none" {
  if (!state?.can_edit) return "none";
  if (state.source === "recorded" && (state.stale || !state.timing_source)) return "transcribe";
  return "generate";
}
