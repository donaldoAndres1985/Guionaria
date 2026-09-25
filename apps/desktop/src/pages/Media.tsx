import { Images } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function MediaPage() {
  return (
    <PlaceholderPage
      title="Medios"
      icon={Images}
      emptyTitle="La biblioteca de medios está vacía"
      description="Todos los medios descargados de todos los proyectos, con filtros por tipo, canal, proveedor, licencia y orientación."
      phase="Fase 3"
    />
  );
}
