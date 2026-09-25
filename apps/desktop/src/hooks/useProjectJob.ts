import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/api";
import { isJobActive, useActiveJobs, useJob } from "./useJobs";

/**
 * Sigue un trabajo en segundo plano de un tipo concreto (generar guion, generar escenas…).
 * Si sales de la pantalla y vuelves, retoma el que siga activo.
 */
export function useProjectJob(
  projectId: number,
  jobType: string,
  launch: () => Promise<Job>,
  onDone?: (job: Job) => void,
) {
  const { data: active = [] } = useActiveJobs(projectId);
  const [startedId, setStartedId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const jobId = startedId ?? active.find((j) => j.type === jobType)?.id ?? null;
  const { data: job } = useJob(jobId);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && job?.status === "done") onDoneRef.current?.(job);
    wasActive.current = isJobActive(job);
  }, [job]);

  return {
    job,
    running: starting || isJobActive(job),
    error: job?.status === "failed" ? job.error : null,
    start: async () => {
      setStarting(true);
      try {
        setStartedId((await launch()).id);
      } catch {
        // el aviso de error ya lo muestra la caché de mutaciones
      } finally {
        setStarting(false);
      }
    },
    dismissError: () => setStartedId(null),
  };
}

export type ProjectJob = ReturnType<typeof useProjectJob>;
