import type { LibraryItem } from "@/lib/api";
import { PROVIDER_LABEL } from "@/features/media/useMediaController";

export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? (p === "ytdlp" ? "Video desde URL" : p);

export const ORIENTATION_LABEL: Record<string, string> = {
  landscape: "Horizontal",
  portrait: "Vertical",
  square: "Cuadrada",
};

/** «Escena 2 (principal)», «Escenas 2 y 5», o «Sin usar». */
export function usageLabel(item: LibraryItem): string {
  if (!item.used_in.length) return "Sin usar";
  const positions = item.used_in.map((u) => u.position);
  if (positions.length === 1) {
    return `Escena ${positions[0]}${item.used_in[0].role === "alt" ? " (alterno)" : ""}`;
  }
  return `Escenas ${positions.slice(0, -1).join(", ")} y ${positions.at(-1)}`;
}

/** Proyectos donde se puede reutilizar: medios abiertos (escenas aprobadas, sin cerrar medios). */
export const REUSE_STATUSES = ["ESCENAS_APROBADAS", "MEDIOS_EN_REVISION"] as const;
