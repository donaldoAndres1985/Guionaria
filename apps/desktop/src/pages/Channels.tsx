import { Tv } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function ChannelsPage() {
  return (
    <PlaceholderPage
      title="Canales y marca"
      icon={Tv}
      emptyTitle="Sin canales"
      description="Crea tus canales con plataformas, idioma, tono del guion, voz por defecto y kit de marca."
      phase="Fase 1"
      withChannel={false}
    />
  );
}
