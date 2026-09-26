import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type RenderState } from "@/lib/api";

export const renderKey = (projectId: number) => ["render", projectId] as const;

export function useRenderState(projectId: number) {
  return useQuery({ queryKey: renderKey(projectId), queryFn: () => api.get<RenderState>(`/api/projects/${projectId}/render`) });
}

export function useStartRender(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { draft: boolean; burn_subtitles: boolean | null }) =>
      api.post<Job>(`/api/projects/${projectId}/render`, body),
    onSuccess: (job) => client.setQueryData(["job", job.id], job),
  });
}
