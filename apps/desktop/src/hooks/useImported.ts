import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type Project } from "@/lib/api";

export interface ImportResult {
  project: Project;
  job: Job | null;
}

export interface ImportVideoInput {
  channelId: number;
  file: File;
  title: string;
  notes: string;
  targetPublishAt: string;
  transcribe: boolean;
}

/** Importa un video ya terminado (CapCut…) como proyecto listo para publicar. */
export function useImportVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportVideoInput) => {
      const body = new FormData();
      body.append("file", input.file, input.file.name);
      body.append("title", input.title);
      if (input.notes.trim()) body.append("notes", input.notes.trim());
      if (input.targetPublishAt) body.append("target_publish_at", input.targetPublishAt);
      body.append("transcribe", String(input.transcribe));
      return api.upload<ImportResult>(`/api/channels/${input.channelId}/projects:import-video`, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** Nueva versión del video importado (otra exportación del editor). */
export function useReplaceVideo(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, transcribe }: { file: File; transcribe: boolean }) => {
      const body = new FormData();
      body.append("file", file, file.name);
      body.append("transcribe", String(transcribe));
      return api.upload<ImportResult>(`/api/projects/${projectId}/video:replace`, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project", projectId] });
      void client.invalidateQueries({ queryKey: ["publishing", projectId] });
      void client.invalidateQueries({ queryKey: ["render", projectId] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useTranscript(projectId: number) {
  return useQuery({
    queryKey: ["transcript", projectId],
    queryFn: () => api.get<{ text: string | null }>(`/api/projects/${projectId}/transcript`),
  });
}

export const startTranscription = (projectId: number) => api.post<Job>(`/api/projects/${projectId}:transcribe-video`, {});
