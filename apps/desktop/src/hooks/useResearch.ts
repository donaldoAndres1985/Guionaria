import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type Job } from "@/lib/api";
import { isJobActive, useJob } from "./useJobs";

export type ResearchTarget = { kind: "idea"; id: number } | { kind: "project"; id: number };

const endpoint = (t: ResearchTarget) =>
  t.kind === "idea" ? `/api/ideas/${t.id}:research` : `/api/projects/${t.id}/research`;

/** «Investigar con fuentes»: lanza el trabajo y lo sigue hasta que termina. */
export function useResearch(target: ResearchTarget) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState<number | null>(null);
  const { data: job } = useJob(jobId);
  const start = useMutation({
    mutationFn: () => api.post<Job>(endpoint(target), {}),
    onSuccess: (j) => {
      client.setQueryData(["job", j.id], j);
      setJobId(j.id);
    },
  });

  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = job?.status;
    if (status === last.current) return;
    last.current = status;
    if (status === "done") {
      const r = (job?.result ?? {}) as { datos?: number; fuentes?: number; en_disputa?: number };
      toast.success(`Investigación lista: ${r.datos ?? 0} datos con ${r.fuentes ?? 0} fuentes`, {
        description: r.en_disputa ? `${r.en_disputa} datos en disputa: revísalos.` : undefined,
      });
      void client.invalidateQueries({ queryKey: ["ideas"] });
      if (target.kind === "project") void client.invalidateQueries({ queryKey: ["project", target.id] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    } else if (status === "failed") {
      toast.error(job?.error ?? "No se pudo investigar");
    }
  }, [job?.status, job?.error, job?.result, client, target.kind, target.id]);

  return {
    start: () => start.mutate(),
    running: start.isPending || isJobActive(job),
    message: job?.message ?? null,
    error: job?.status === "failed" ? job.error : null,
  };
}
