import type { Candidate } from "@/lib/api";

export function formatResolution(w: number | null, h: number | null): string | null {
  return w && h ? `${w}×${h}` : null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatClip(seconds: number | null): string | null {
  if (seconds == null) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** ¿El candidato coincide con la orientación del proyecto? (si no, se recortará) */
export function orientationMismatch(c: Candidate, target: "landscape" | "portrait"): boolean {
  if (!c.width || !c.height) return false;
  return target === "landscape" ? c.width < c.height : c.height < c.width;
}

export function canSelect(c: Candidate): boolean {
  return c.download_status === "none" || c.download_status === "failed";
}

export const STATUS_TEXT: Record<string, string> = {
  pending: "Sin buscar",
  candidates: "Candidatos",
  approved: "Aprobado",
  manual: "Manual",
  review: "Revisar",
};
