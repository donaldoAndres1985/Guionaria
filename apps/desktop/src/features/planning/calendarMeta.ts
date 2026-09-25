import type { Project, ProjectStatus } from "@/lib/api";
import { STATUS_ORDER } from "@/lib/project";

export const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Fecha local como YYYY-MM-DD (sin pasar por UTC, que cambiaría el día). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Lunes de la semana de `d`. */
export function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // lunes = 0
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -day);
}

/** 6 semanas × 7 días que cubren el mes (empezando en lunes). */
export function monthGrid(year: number, month: number): Date[] {
  const first = startOfWeek(new Date(year, month, 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function weekDays(d: Date): Date[] {
  const first = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function byDate(projects: Project[]): Map<string, Project[]> {
  const out = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.target_publish_at) continue;
    const key = p.target_publish_at.slice(0, 10);
    out.set(key, [...(out.get(key) ?? []), p]);
  }
  return out;
}

// --- tablero ---

export interface Column {
  id: string;
  label: string;
  statuses: ProjectStatus[];
  /** Se puede soltar aquí (etapas finales que se hacen fuera de la app). */
  manual: boolean;
}

export const COLUMNS: Column[] = [
  { id: "guion", label: "Guion", statuses: ["IDEA", "GUION_BORRADOR"], manual: false },
  { id: "escenas", label: "Escenas", statuses: ["GUION_APROBADO", "ESCENAS_BORRADOR"], manual: false },
  { id: "medios", label: "Medios", statuses: ["ESCENAS_APROBADAS", "MEDIOS_EN_REVISION"], manual: false },
  { id: "voz", label: "Voz", statuses: ["MEDIOS_APROBADOS"], manual: false },
  { id: "timeline", label: "Timeline", statuses: ["VOZ_LISTA"], manual: false },
  { id: "TIMELINE_LISTO", label: "Para editar", statuses: ["TIMELINE_LISTO"], manual: true },
  { id: "RENDERIZADO", label: "Renderizado", statuses: ["RENDERIZADO"], manual: true },
  { id: "PROGRAMADO", label: "Programado", statuses: ["PROGRAMADO"], manual: true },
  { id: "PUBLICADO", label: "Publicado", statuses: ["PUBLICADO"], manual: true },
];

export const columnOf = (status: ProjectStatus) => COLUMNS.find((c) => c.statuses.includes(status))!;

/** Solo las tarjetas que ya tienen el timeline se mueven a mano, y solo entre etapas finales. */
export function canMove(status: ProjectStatus, target: Column): boolean {
  return columnOf(status).manual && target.manual && !target.statuses.includes(status);
}

/** Próximas publicaciones sin terminar (para los recordatorios). */
export function dueSoon(projects: Project[], today: Date, days = 1): Project[] {
  const limit = isoDate(addDays(today, days));
  const from = isoDate(today);
  return projects.filter(
    (p) =>
      p.target_publish_at &&
      p.target_publish_at.slice(0, 10) >= from &&
      p.target_publish_at.slice(0, 10) <= limit &&
      STATUS_ORDER.indexOf(p.status) < STATUS_ORDER.indexOf("PUBLICADO"),
  );
}

export type DropAction =
  | { kind: "reschedule"; date: string | null }
  | { kind: "status"; status: ProjectStatus }
  | { kind: "blocked" }
  | null;

/** Qué hacer al soltar una tarjeta en un día, en «Sin fecha» o en una columna del tablero. */
export function dropAction(project: Project, target: string): DropAction {
  if (target.startsWith("date-") || target === "undated") {
    const date = target === "undated" ? null : target.slice(5);
    return date === (project.target_publish_at?.slice(0, 10) ?? null) ? null : { kind: "reschedule", date };
  }
  const column = COLUMNS.find((c) => `col-${c.id}` === target);
  if (!column || column.statuses.includes(project.status)) return null;
  return canMove(project.status, column) ? { kind: "status", status: column.statuses[0] } : { kind: "blocked" };
}
