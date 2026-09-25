import { HardDrive } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function StoragePage() {
  return (
    <PlaceholderPage
      title="Almacenamiento"
      icon={HardDrive}
      emptyTitle="Sin datos de almacenamiento"
      description="Espacio por canal, proyecto y tipo de medio con treemap, y limpieza de candidatos no usados."
      phase="Fase 3"
    />
  );
}
