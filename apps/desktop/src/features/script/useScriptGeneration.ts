import { toast } from "sonner";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useGenerateScript } from "@/hooks/useScript";
import type { Project } from "@/lib/api";

/** Generación del guion en segundo plano: se retoma si sales y vuelves a la pantalla. */
export function useScriptGeneration(project: Project) {
  const mutation = useGenerateScript(project.id);
  const job = useProjectJob(project.id, "generate_script", () => mutation.mutateAsync(), (done) => {
    const segments = (done.result?.segments as number | undefined) ?? 0;
    toast.success(`Guion generado: ${segments} segmentos`);
  });
  return {
    job: job.job,
    generating: job.running,
    error: job.error,
    start: () => void job.start(),
    dismissError: job.dismissError,
  };
}

export type ScriptGeneration = ReturnType<typeof useScriptGeneration>;
