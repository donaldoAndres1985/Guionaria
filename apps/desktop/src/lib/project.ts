import {
  AudioLines,
  Clapperboard,
  FileText,
  Film,
  Images,
  type LucideIcon,
  Send,
} from "lucide-react";
import type { Project, ProjectStatus } from "./api";

/** Orden de la máquina de estados (sección 2 de SPEC.md). */
export const STATUS_ORDER: ProjectStatus[] = [
  "IDEA",
  "GUION_BORRADOR",
  "GUION_APROBADO",
  "ESCENAS_BORRADOR",
  "ESCENAS_APROBADAS",
  "MEDIOS_EN_REVISION",
  "MEDIOS_APROBADOS",
  "VOZ_LISTA",
  "TIMELINE_LISTO",
  "RENDERIZADO",
  "PROGRAMADO",
  "PUBLICADO",
];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  IDEA: "Idea",
  GUION_BORRADOR: "Guion en revisión",
  GUION_APROBADO: "Guion aprobado",
  ESCENAS_BORRADOR: "Escenas en revisión",
  ESCENAS_APROBADAS: "Escenas aprobadas",
  MEDIOS_EN_REVISION: "Medios en revisión",
  MEDIOS_APROBADOS: "Medios aprobados",
  VOZ_LISTA: "Voz lista",
  TIMELINE_LISTO: "Timeline listo",
  RENDERIZADO: "Renderizado",
  PROGRAMADO: "Programado",
  PUBLICADO: "Publicado",
};

export type StageId = "guion" | "escenas" | "medios" | "voz" | "timeline" | "publicacion";
export type StageState = "pending" | "active" | "done";

export interface Stage {
  id: StageId;
  label: string;
  icon: LucideIcon;
  /** Primer estado en que la etapa está en curso. */
  activeFrom: ProjectStatus;
  /** Estado desde el que la etapa se considera terminada. */
  doneFrom: ProjectStatus;
}

/** Etapas del proyecto, en el orden del flujo (sección 15.2, referencia 03). */
export const STAGES: Stage[] = [
  { id: "guion", label: "Guion", icon: FileText, activeFrom: "IDEA", doneFrom: "GUION_APROBADO" },
  {
    id: "escenas",
    label: "Escenas",
    icon: Clapperboard,
    activeFrom: "GUION_APROBADO",
    doneFrom: "ESCENAS_APROBADAS",
  },
  {
    id: "medios",
    label: "Medios",
    icon: Images,
    activeFrom: "ESCENAS_APROBADAS",
    doneFrom: "MEDIOS_APROBADOS",
  },
  { id: "voz", label: "Voz", icon: AudioLines, activeFrom: "MEDIOS_APROBADOS", doneFrom: "VOZ_LISTA" },
  { id: "timeline", label: "Timeline", icon: Film, activeFrom: "VOZ_LISTA", doneFrom: "TIMELINE_LISTO" },
  {
    id: "publicacion",
    label: "Publicación",
    icon: Send,
    activeFrom: "TIMELINE_LISTO",
    doneFrom: "PUBLICADO",
  },
];

const idx = (s: ProjectStatus) => STATUS_ORDER.indexOf(s);

export function stageState(stage: Stage, status: ProjectStatus): StageState {
  if (idx(status) >= idx(stage.doneFrom)) return "done";
  if (idx(status) >= idx(stage.activeFrom)) return "active";
  return "pending";
}

/** Etapa en la que está el proyecto; null si ya está publicado. */
export function currentStage(status: ProjectStatus): Stage | null {
  return STAGES.find((s) => stageState(s, status) === "active") ?? null;
}

export const isCompleted = (p: Project) => idx(p.status) >= idx("TIMELINE_LISTO");

export const FORMAT_LABEL = { video: "Video 16:9", reel: "Reel 9:16" } as const;

export const PRIORITY_LABEL: Record<number, string> = { 1: "Alta", 2: "Media", 3: "Baja" };

/** 600 → "10:00", 75 → "1:15". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "2026-10-03" → "3 oct 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export function isThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const now = new Date();
  return iso.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
}
