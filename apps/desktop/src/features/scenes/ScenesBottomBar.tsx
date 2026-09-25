import { LoaderCircle, Sparkles, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import { useApproveScenes, useScenes, useUnlockScenes } from "@/hooks/useScenes";
import type { Project } from "@/lib/api";
import { formatDuration, STATUS_ORDER } from "@/lib/project";
import type { ScenesGeneration } from "./useScenesGeneration";

export function ScenesBottomBar({
  project,
  generation,
}: {
  project: Project;
  generation: ScenesGeneration;
}) {
  const { data: state } = useScenes(project.id);
  const approve = useApproveScenes(project.id);
  const unlock = useUnlockScenes(project.id);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const scriptApproved =
    STATUS_ORDER.indexOf(project.status) >= STATUS_ORDER.indexOf("GUION_APROBADO");

  if (generation.running || !state?.scenes.length) {
    return (
      <BottomBar stats={[{ label: "Etapa", value: "Escenas" }]}>
        <Button
          size="lg"
          disabled={generation.running || !scriptApproved}
          onClick={() => generation.start("all")}
        >
          {generation.running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {generation.running ? "Generando escenas…" : "Generar escenas con Claude"}
        </Button>
      </BottomBar>
    );
  }

  const blockers = state.review_count + state.segments_without_scenes.length;
  const stats = [
    { label: "Escenas", value: state.scenes.length },
    { label: "Duración estimada", value: formatDuration(state.total_s), highlight: true },
    {
      label: "Por revisar",
      value: <span className={blockers ? "text-warning" : undefined}>{blockers}</span>,
    },
  ];

  if (state.approved) {
    return (
      <BottomBar stats={stats}>
        <Button variant="outline" disabled={unlock.isPending} onClick={() => setConfirmUnlock(true)}>
          <Unlock /> Desbloquear
        </Button>
        <Button size="lg" disabled>
          Escenas aprobadas
        </Button>
        <ConfirmDialog
          open={confirmUnlock}
          onOpenChange={setConfirmUnlock}
          title="¿Desbloquear las escenas?"
          description="Podrás editarlas otra vez. Tendrás que aprobarlas de nuevo antes de seguir con los medios."
          confirmLabel="Desbloquear"
          onConfirm={() => {
            setConfirmUnlock(false);
            unlock.mutate();
          }}
        />
      </BottomBar>
    );
  }

  return (
    <BottomBar stats={stats}>
      <Button
        size="lg"
        className="min-w-40"
        disabled={!state.editable || blockers > 0 || approve.isPending}
        title={
          blockers > 0
            ? "Resuelve las escenas por revisar y los segmentos sin escenas"
            : !state.editable
              ? "Aprueba el guion primero"
              : undefined
        }
        onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success("Escenas aprobadas") })}
      >
        Aprobar escenas
      </Button>
    </BottomBar>
  );
}
