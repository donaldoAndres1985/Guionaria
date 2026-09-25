import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type MediaOverview, type SceneMedia, type SearchResult } from "@/lib/api";

export const mediaKeys = {
  overview: (pid: number) => ["media", pid] as const,
  scene: (sceneId: number) => ["scene-media", sceneId] as const,
};

export function useMediaOverview(projectId: number) {
  return useQuery({
    queryKey: mediaKeys.overview(projectId),
    queryFn: () => api.get<MediaOverview>(`/api/projects/${projectId}/media`),
  });
}

export function useSceneMedia(sceneId: number | null) {
  return useQuery({
    queryKey: mediaKeys.scene(sceneId ?? 0),
    queryFn: () => api.get<SceneMedia>(`/api/scenes/${sceneId}/media`),
    enabled: sceneId != null,
  });
}

function useOnSceneMedia(projectId: number) {
  const client = useQueryClient();
  return (media: SceneMedia) => {
    client.setQueryData(mediaKeys.scene(media.scene_id), media);
    void client.invalidateQueries({ queryKey: mediaKeys.overview(projectId) });
    void client.invalidateQueries({ queryKey: ["project", projectId] });
  };
}

export interface SearchArgs {
  sceneId: number;
  query?: string;
  providers?: string[];
  page?: number;
  any_orientation?: boolean;
}

export function useSearchMedia(projectId: number) {
  const onScene = useOnSceneMedia(projectId);
  return useMutation({
    mutationFn: ({ sceneId, ...body }: SearchArgs) =>
      api.post<SearchResult>(`/api/scenes/${sceneId}/search`, body),
    onSuccess: (result) => onScene(result.scene),
  });
}

export function useSuggestQueries() {
  return useMutation({
    mutationFn: (sceneId: number) =>
      api.post<{ queries: string[] }>(`/api/scenes/${sceneId}/queries:suggest`, {}),
  });
}

export function useDownloadCandidates(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, ids }: { sceneId: number; ids: number[] }) =>
      api.post<Job>(`/api/scenes/${sceneId}/candidates:download`, { candidate_ids: ids }),
    onSuccess: (job, { sceneId }) => {
      client.setQueryData(["job", job.id], job);
      void client.invalidateQueries({ queryKey: mediaKeys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: mediaKeys.overview(projectId) });
    },
  });
}

export function useApproveAsset(projectId: number) {
  const onScene = useOnSceneMedia(projectId);
  return useMutation({
    mutationFn: ({ sceneId, assetId, role }: { sceneId: number; assetId: number; role: "main" | "alt" }) =>
      api.post<SceneMedia>(`/api/scenes/${sceneId}/assets/${assetId}:approve`, { role }),
    onSuccess: onScene,
  });
}

export function useUnapproveAsset(projectId: number) {
  const onScene = useOnSceneMedia(projectId);
  return useMutation({
    mutationFn: ({ sceneId, assetId }: { sceneId: number; assetId: number }) =>
      api.post<SceneMedia>(`/api/scenes/${sceneId}/assets/${assetId}:unapprove`, {}),
    onSuccess: onScene,
  });
}

function useStageChange(projectId: number) {
  const client = useQueryClient();
  return (overview: MediaOverview) => {
    client.setQueryData(mediaKeys.overview(projectId), overview);
    void client.invalidateQueries({ queryKey: ["project", projectId] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  };
}

export function useApproveMedia(projectId: number) {
  const onChange = useStageChange(projectId);
  return useMutation({
    mutationFn: () => api.post<MediaOverview>(`/api/projects/${projectId}/media:approve`, {}),
    onSuccess: onChange,
  });
}

export function useUnlockMedia(projectId: number) {
  const onChange = useStageChange(projectId);
  return useMutation({
    mutationFn: () => api.post<MediaOverview>(`/api/projects/${projectId}/media:unlock`, {}),
    onSuccess: onChange,
  });
}
