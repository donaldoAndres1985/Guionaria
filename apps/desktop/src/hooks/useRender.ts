import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type RenderQuality, type RenderState, type SubtitleStyle, type TextStyle, type VideoLook } from "@/lib/api";

export const renderKey = (projectId: number) => ["render", projectId] as const;

export function useRenderState(projectId: number) {
  return useQuery({ queryKey: renderKey(projectId), queryFn: () => api.get<RenderState>(`/api/projects/${projectId}/render`) });
}

export function useStartRender(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      quality: RenderQuality;
      burn_subtitles: boolean | null;
      subtitle_style?: SubtitleStyle | null;
      text_style?: TextStyle | null;
      look?: VideoLook | null;
    }) =>
      api.post<Job>(`/api/projects/${projectId}/render`, body),
    onSuccess: (job) => client.setQueryData(["job", job.id], job),
  });
}

/** Detiene un trabajo en curso (el render mata FFmpeg y conserva el archivo anterior). */
export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.post<Job>(`/api/jobs/${jobId}:cancel`, {}),
    onSuccess: (job) => client.setQueryData(["job", job.id], job),
  });
}

/** Importa un LUT .cube (queda en la carpeta luts/ de Guionaria). */
export function useImportLut(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.upload<{ luts: string[]; imported: string | null }>("/api/looks/luts:upload", body);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: renderKey(projectId) }),
  });
}
