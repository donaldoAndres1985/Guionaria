import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { api, CORE_URL, type Job } from "@/lib/api";

const isActive = (job: Job | null | undefined) =>
  job?.status === "queued" || job?.status === "running";

function onJobFinished(client: QueryClient, job: Job) {
  if (job.project_id == null) return;
  const pid = job.project_id;
  const keys = [["script", pid], ["script-versions", pid], ["scenes", pid], ["voice", pid], ["timeline", pid], ["project", pid], ["projects"]];
  for (const key of keys) {
    void client.invalidateQueries({ queryKey: key });
  }
}

/** Se monta una vez (AppShell): escucha /ws/jobs y actualiza la caché en vivo. */
export function useJobEvents() {
  const client = useQueryClient();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(`${CORE_URL.replace(/^http/, "ws")}/ws/jobs`);
      socket.onmessage = (event) => {
        const job = JSON.parse(event.data) as Job;
        client.setQueryData(["job", job.id], job);
        if (job.project_id != null) {
          client.setQueryData<Job[]>(["active-jobs", job.project_id], (old = []) => {
            const rest = old.filter((j) => j.id !== job.id);
            return isActive(job) ? [job, ...rest] : rest;
          });
        }
        // Cada paso de una descarga actualiza la galería (candidato descargado, fallido…).
        if (job.type === "download_url" && !isActive(job)) {
          if (job.status === "done") toast.success(`Video agregado: ${String(job.result?.title ?? "")}`);
          else toast.error(job.error ?? "No se pudo descargar el video");
        }
        if (job.type === "frame_media" && !isActive(job)) {
          if (job.status === "done") toast.success("Video encuadrado");
          else toast.error(job.error ?? "No se pudo encuadrar el video");
          void client.invalidateQueries({ queryKey: ["framing"] });
        }
        if (job.type === "download_media" || job.type === "download_url" || job.type === "frame_media") {
          void client.invalidateQueries({ queryKey: ["scene-media"] });
          if (job.project_id != null) void client.invalidateQueries({ queryKey: ["media", job.project_id] });
        }
        if (!isActive(job)) onJobFinished(client, job);
      };
      // Si el núcleo se reinicia, se reconecta solo.
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [client]);
}

/** Trabajos activos de un proyecto (para retomar el progreso al volver a la pantalla). */
export function useActiveJobs(projectId: number) {
  return useQuery({
    queryKey: ["active-jobs", projectId],
    queryFn: () => api.get<Job[]>(`/api/jobs?project_id=${projectId}&active=true`),
  });
}

/** Un trabajo concreto. El WebSocket lo actualiza; el sondeo es solo un respaldo. */
export function useJob(jobId: number | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/api/jobs/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (q) => (isActive(q.state.data) ? 3000 : false),
  });
  const job = query.data;
  // Respaldo por si el WebSocket no estaba conectado cuando terminó.
  useEffect(() => {
    if (job && !isActive(job)) onJobFinished(client, job);
  }, [client, job?.status]); // solo al cambiar de estado, no en cada sondeo
  return query;
}

export { isActive as isJobActive };
