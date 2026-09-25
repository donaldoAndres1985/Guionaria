import { Lightbulb } from "lucide-react";
import { PlaceholderPage } from "./PlaceholderPage";

export function IdeasPage() {
  return (
    <PlaceholderPage
      title="Ideas"
      icon={Lightbulb}
      emptyTitle="El banco de ideas está vacío"
      description="Guarda ideas por canal con prioridad y notas, y conviértelas en proyecto con un clic."
      phase="Fase 3"
    />
  );
}
