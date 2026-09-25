import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isJobActive, useActiveJobs, useJob } from "@/hooks/useJobs";
import { useGenerateScript } from "@/hooks/useScript";
import type { Project } from "@/lib/api";

/** Generación del guion en segundo plano: se retoma si sales y vuelves a la pantalla. */
export function useScriptGeneration(project: Project) {
  const { data: active = [] } = useActiveJobs(project.id);
  const [startedId, setStartedId] = useState<number | null>(null);
  const activeGeneration = active.find((j) => j.type === "generate_script");
  const jobId = startedId ?? activeGeneration?.id ?? null;
  const { data: job } = useJob(jobId);
  const mutation = useGenerateScript(project.id);

  // Aviso al terminar (solo para trabajos seguidos en esta pantalla).
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && job?.status === "done") {
      const segments = (job.result?.segments as number | undefined) ?? 0;
      toast.success(`Guion generado: ${segments} segmentos`);
    }
    wasActive.current = isJobActive(job);
  }, [job]);

  return {
    job,
    generating: mutation.isPending || isJobActive(job),
    error: job?.status === "failed" ? job.error : null,
    start: () => mutation.mutate(undefined, { onSuccess: (j) => setStartedId(j.id) }),
    dismissError: () => setStartedId(null),
  };
}

export type ScriptGeneration = ReturnType<typeof useScriptGeneration>;
