import type { HistoryActor, HistoryItem } from "@/lib/api";

export const ACTOR_LABEL: Record<HistoryActor, string> = { ui: "Tú", mcp: "Claude (MCP)", system: "Sistema" };

export const GROUPS: { id: string; label: string }[] = [
  { id: "project", label: "Proyectos" },
  { id: "script", label: "Guion" },
  { id: "scenes", label: "Escenas" },
  { id: "media", label: "Medios" },
  { id: "voice", label: "Voz" },
  { id: "timeline", label: "Timeline" },
  { id: "ideas", label: "Ideas" },
  { id: "channels", label: "Canales" },
];

/** «Hoy», «Ayer» o la fecha, según el día local de la operación. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key(d) === key(now)) return "Hoy";
  if (key(d) === key(yesterday)) return "Ayer";
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Agrupa por día manteniendo el orden (más recientes primero). */
export function groupByDay(items: HistoryItem[], now = new Date()): { day: string; items: HistoryItem[] }[] {
  const out: { day: string; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.at, now);
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
