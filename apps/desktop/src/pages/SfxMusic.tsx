import { Music } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function SfxMusicPage() {
  return (
    <PlaceholderPage
      title="SFX y música"
      icon={Music}
      emptyTitle="Sin efectos ni música"
      description="Biblioteca local etiquetada de efectos de sonido y música, con búsqueda en Freesound."
      phase="Fase 3"
    />
  );
}
