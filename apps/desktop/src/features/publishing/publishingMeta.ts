import type { Publication, PublicationStatus, PublishPlatform } from "@/lib/api";

export const PLATFORM_TONE: Record<PublishPlatform, string> = {
  youtube: "bg-[#ff3b30]",
  tiktok: "bg-[#25f4ee]",
  instagram: "bg-[#e1306c]",
  facebook: "bg-[#1877f2]",
};

const shortDate = (iso: string) => new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

export const STATUS_TEXT: Record<PublicationStatus, (p: Pick<Publication, "scheduled_at" | "published_at" | "external_url">) => string> = {
  draft: () => "Borrador",
  scheduled: (p) => (p.scheduled_at ? `Programado · ${shortDate(p.scheduled_at)}` : "Programado"),
  uploading: () => "Subiendo…",
  published: (p) => (p.published_at ? `Publicado · ${shortDate(p.published_at)}` : "Publicado"),
  failed: () => "Falló la subida",
};

export const STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  uploading: "Subiendo",
  published: "Publicado",
  failed: "Falló",
};

/** «#uno #dos», «uno, dos» → ["uno", "dos"]. */
export function splitList(value: string, separator: "," | "any" = "any"): string[] {
  const parts = separator === "," ? value.split(",") : value.split(/[\s,]+/);
  return parts.map((p) => p.trim().replace(/^#/, "")).filter(Boolean);
}

/** ISO con zona → valor de <input type="datetime-local"> en la hora local. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de datetime-local (hora local) → ISO con zona horaria. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
