import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CoverDesign, type Job, type PublicationUpdate, type PublishingState, type QueueItem } from "@/lib/api";

export const publishingKey = (projectId: number) => ["publishing", projectId] as const;

export function usePublishing(projectId: number, poll = false, enabled = true) {
  return useQuery({
    enabled,
    queryKey: publishingKey(projectId),
    queryFn: () => api.get<PublishingState>(`/api/projects/${projectId}/publishing`),
    // Mientras se espera el inicio de sesión de Google en el navegador.
    refetchInterval: poll ? 2000 : false,
  });
}

export function usePublishingQueue(channelId?: number | null) {
  return useQuery({
    queryKey: ["publishing", "queue", channelId ?? null],
    queryFn: () => api.get<QueueItem[]>(`/api/publishing/queue${channelId ? `?channel_id=${channelId}` : ""}`),
  });
}

/** Mutaciones que devuelven el estado de la publicación del proyecto. */
export function usePublishingActions(projectId: number) {
  const client = useQueryClient();
  const done = (state: PublishingState) => {
    client.setQueryData(publishingKey(projectId), state);
    void client.invalidateQueries({ queryKey: ["publishing", "queue"] });
    void client.invalidateQueries({ queryKey: ["project", projectId] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  };
  return {
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: PublicationUpdate }) =>
        api.patch<PublishingState>(`/api/publications/${id}`, data),
      onSuccess: done,
    }),
    markPublished: useMutation({
      mutationFn: ({ id, url }: { id: number; url: string }) =>
        api.post<PublishingState>(`/api/publications/${id}:published`, { url }),
      onSuccess: done,
    }),
    reopen: useMutation({
      mutationFn: (id: number) => api.post<PublishingState>(`/api/publications/${id}:reopen`, {}),
      onSuccess: done,
    }),
    thumbnail: useMutation({
      mutationFn: (body: { time_s: number; text: string | null }) =>
        api.post<PublishingState>(`/api/projects/${projectId}/publishing/thumbnail`, body),
      onSuccess: done,
    }),
    reveal: useMutation({ mutationFn: () => api.post<void>(`/api/projects/${projectId}/publishing:reveal`, {}) }),
    chooseCover: useMutation({
      mutationFn: (index: number) => api.post<PublishingState>(`/api/projects/${projectId}/publishing/cover:choose`, { index }),
      onSuccess: done,
    }),
    redrawCover: useMutation({
      mutationFn: (body: { index: number; design: CoverDesign }) =>
        api.post<PublishingState>(`/api/projects/${projectId}/publishing/cover:redraw`, body),
      onSuccess: done,
    }),
    generate: () => api.post<Job>(`/api/projects/${projectId}/publishing:generate`, {}),
    suggestTitles: (id: number) => api.post<Job>(`/api/publications/${id}:titles`, {}),
    designCover: () => api.post<Job>(`/api/projects/${projectId}/publishing/cover:design`, {}),
    upload: (id: number) => api.post<Job>(`/api/publications/${id}:upload`, {}),
  };
}

export function useYouTube(channelId: number | undefined) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ["publishing"] });
  return {
    connect: useMutation({
      mutationFn: () => api.post<{ auth_url: string }>(`/api/channels/${channelId}/youtube:connect`, {}),
    }),
    disconnect: useMutation({
      mutationFn: () => api.post<void>(`/api/channels/${channelId}/youtube:disconnect`, {}),
      onSuccess: refresh,
    }),
  };
}

export function usePlaylists(channelId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["youtube", "playlists", channelId],
    queryFn: () => api.get<{ id: string; title: string }[]>(`/api/channels/${channelId}/youtube/playlists`),
    enabled: enabled && !!channelId,
    retry: false,
  });
}
