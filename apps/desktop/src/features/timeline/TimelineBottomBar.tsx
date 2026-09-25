import { Film, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import { useExportTimeline, useTimeline } from "@/hooks/useTimeline";
import type { Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { clipCount } from "./timelineMeta";

export function TimelineBottomBar({ project }: { project: Project }) {
  const { data: state } = useTimeline(project.id);
  const exporter = useExportTimeline(project.id);
  const stats = [
    { label: "Duración", value: formatDuration(state?.duration_s), highlight: true },
    { label: "Clips", value: state ? `${clipCount(state)}/${state.scenes.length}` : "—" },
    { label: "Voz", value: state?.has_voice ? "Incluida" : "Sin voz" },
  ];
  const exported = (state?.exports.length ?? 0) > 0;

  return (
    <BottomBar stats={stats}>
      <Button
        size="lg"
        className="min-w-44"
        disabled={!state?.can_export || exporter.isPending}
        title={state?.reason ?? undefined}
        onClick={() =>
          exporter.mutate(undefined, {
            onSuccess: (r) => {
              toast.success(`Timeline exportado: ${r.files.join(", ")}`);
              if (r.warnings.length) toast.warning(`${r.warnings.length} avisos: revísalos antes de editar`);
            },
          })
        }
      >
        {exporter.isPending ? <LoaderCircle className="animate-spin" /> : <Film />}
        {exported ? "Exportar otra vez" : "Exportar timeline"}
      </Button>
    </BottomBar>
  );
}
