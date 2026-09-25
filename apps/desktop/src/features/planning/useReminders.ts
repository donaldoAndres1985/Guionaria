import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { toast } from "sonner";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/lib/api";
import { dueSoon, isoDate } from "./calendarMeta";

const KEY = "guionaria-reminders";

/** Ids ya avisados hoy (localStorage): cada proyecto se recuerda una vez al día. */
export function takeUnnotified(projects: Project[], today: string): Project[] {
  let seen: { date: string; ids: number[] } = { date: today, ids: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (stored?.date === today) seen = stored;
  } catch {
    // almacenamiento no disponible: se avisa igual
  }
  const fresh = projects.filter((p) => !seen.ids.includes(p.id));
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: today, ids: [...seen.ids, ...fresh.map((p) => p.id)] }));
  } catch {
    // sin almacenamiento
  }
  return fresh;
}

export function reminderText(p: Project, today: string): string {
  const when = p.target_publish_at?.slice(0, 10) === today ? "hoy" : "mañana";
  return `«${p.title}» se publica ${when} (${p.channel_name}).`;
}

async function notify(title: string, body: string) {
  if (isTauri()) {
    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({ title, body });
      return;
    }
  }
  toast.info(body);
}

/** Recordatorios locales (sección 5.13): publicaciones de hoy y mañana sin terminar. */
export function useReminders() {
  const { data: projects } = useProjects();
  useEffect(() => {
    if (!projects) return;
    const check = () => {
      const today = new Date();
      const iso = isoDate(today);
      for (const p of takeUnnotified(dueSoon(projects, today), iso)) {
        void notify("Guionaria · publicación próxima", reminderText(p, iso));
      }
    };
    check();
    const id = window.setInterval(check, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [projects]);
}
