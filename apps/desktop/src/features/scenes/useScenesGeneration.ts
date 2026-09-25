import { useRef } from "react";
import { toast } from "sonner";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useGenerateScenes } from "@/hooks/useScenes";
import type { Project } from "@/lib/api";

export type ScenesMode = "all" | "pending";

export function useScenesGeneration(project: Project) {
  const mutation = useGenerateScenes(project.id);
  const mode = useRef<ScenesMode>("all");
  const job = useProjectJob(
    project.id,
    "generate_scenes",
    () => mutation.mutateAsync(mode.current),
    (done) => {
      const created = (done.result?.created as number | undefined) ?? 0;
      toast.success(created ? `${created} escenas nuevas` : "No había escenas pendientes");
    },
  );
  return {
    job: job.job,
    running: job.running,
    error: job.error,
    start: (m: ScenesMode) => {
      mode.current = m;
      void job.start();
    },
    dismissError: job.dismissError,
  };
}

export type ScenesGeneration = ReturnType<typeof useScenesGeneration>;
