import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HistoryActor, type HistoryPage, type Project, type RightsReport, type TrashItem } from "@/lib/api";

export function useHistory(filters: { actor?: HistoryActor | null; group?: string | null; project?: number | null }) {
  return useInfiniteQuery({
    queryKey: ["history", filters],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.actor) params.set("actor", filters.actor);
      if (filters.group) params.set("group", filters.group);
      if (filters.project) params.set("project", String(filters.project));
      if (pageParam) params.set("before", String(pageParam));
      const qs = params.toString();
      return api.get<HistoryPage>(`/api/history${qs ? `?${qs}` : ""}`);
    },
    getNextPageParam: (last) => last.next_before,
  });
}

export function useTrash() {
  return useQuery({ queryKey: ["trash"], queryFn: () => api.get<TrashItem[]>("/api/trash") });
}

function useInvalidateTrash() {
  const client = useQueryClient();
  return () => {
    for (const key of ["trash", "projects", "history", "channels", "ideas", "library", "storage-usage"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useRestoreProject() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: (id: number) => api.post<Project>(`/api/trash/${id}:restore`, {}),
    onSuccess: invalidate,
  });
}

export function usePurgeProject() {
  const invalidate = useInvalidateTrash();
  return useMutation({ mutationFn: (id: number) => api.del(`/api/trash/${id}`), onSuccess: invalidate });
}

export function useEmptyTrash() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: () => api.post<{ purged: number }>("/api/trash:empty", {}),
    onSuccess: invalidate,
  });
}

export function useRights(projectId: number) {
  return useQuery({
    queryKey: ["rights", projectId],
    queryFn: () => api.get<RightsReport>(`/api/projects/${projectId}/rights`),
  });
}

export function useExportRights(projectId: number) {
  return useMutation({
    mutationFn: () => api.post<{ path: string }>(`/api/projects/${projectId}/rights:export`, {}),
  });
}
