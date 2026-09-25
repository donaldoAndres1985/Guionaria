import { Send } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function PublishingPage() {
  return (
    <PlaceholderPage
      title="Publicación"
      icon={Send}
      emptyTitle="La cola de publicación está vacía"
      description="Programa la publicación por canal y plataforma (YouTube, TikTok, Instagram) con sus metadatos."
      phase="Fase 5"
    />
  );
}
