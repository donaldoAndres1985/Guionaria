import { History } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function HistoryPage() {
  return (
    <PlaceholderPage
      title="Historial de operaciones"
      icon={History}
      emptyTitle="Sin operaciones registradas"
      description="Qué se generó, descargó, borró o publicó, con papelera de 30 días para deshacer eliminaciones."
      phase="Fase 3"
      withChannel={false}
    />
  );
}
