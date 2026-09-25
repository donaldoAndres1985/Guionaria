import { Clapperboard } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function ProjectsPage() {
  return (
    <PlaceholderPage
      title="Proyectos"
      icon={Clapperboard}
      emptyTitle="Sin proyectos todavía"
      description="Crea un video (16:9) o un reel (9:16) para un canal y avanza por guion, escenas, medios, voz y timeline."
      phase="Fase 1"
    />
  );
}
