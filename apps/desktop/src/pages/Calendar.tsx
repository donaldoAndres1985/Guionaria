import { CalendarDays } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function CalendarPage() {
  return (
    <PlaceholderPage
      title="Calendario"
      icon={CalendarDays}
      emptyTitle="Nada planificado"
      description="Calendario mensual y semanal por canal, y tablero kanban por estado del proyecto."
      phase="Fase 3"
    />
  );
}
