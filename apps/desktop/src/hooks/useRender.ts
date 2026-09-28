import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type RenderQuality, type RenderState, type SubtitleStyle, type TextStyle } from "@/lib/api";

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
