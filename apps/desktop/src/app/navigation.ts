import {
  CalendarDays,
  Clapperboard,
  HardDrive,
  History,
  House,
  Images,
  Lightbulb,
  type LucideIcon,
  Music,
  Send,
  Settings,
  Tv,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Menú lateral (sección 15.3 de SPEC.md). */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Producción",
    items: [
      { path: "/", label: "Inicio", icon: House },
      { path: "/proyectos", label: "Proyectos", icon: Clapperboard },
      { path: "/ideas", label: "Ideas", icon: Lightbulb },
      { path: "/calendario", label: "Calendario", icon: CalendarDays },
    ],
  },
  {
    label: "Biblioteca",
    items: [
      { path: "/medios", label: "Medios", icon: Images },
      { path: "/sfx-musica", label: "SFX y música", icon: Music },
      { path: "/almacenamiento", label: "Almacenamiento", icon: HardDrive },
    ],
  },
  {
    label: "Canales",
    items: [
      { path: "/canales", label: "Canales y marca", icon: Tv },
      { path: "/publicacion", label: "Publicación", icon: Send },
    ],
  },
];

export const SYSTEM_ITEMS: NavItem[] = [
  { path: "/historial", label: "Historial de operaciones", icon: History },
  { path: "/ajustes", label: "Ajustes", icon: Settings },
];
