import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CleanupPreview, type StorageUsage } from "@/lib/api";

export function useStorageUsage() {
  return useQuery({ queryKey: ["storage-usage"], queryFn: () => api.get<StorageUsage>("/api/storage/usage") });
}

export function useCleanupPreview() {
  return useQuery({ queryKey: ["storage-cleanup"], queryFn: () => api.get<CleanupPreview>("/api/storage/cleanup") });
}

export function useCleanup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (projectIds: number[]) =>
      api.post<{ deleted: number; freed_bytes: number }>("/api/storage/cleanup", { project_ids: projectIds }),
    onSuccess: () => {
      for (const key of ["storage-usage", "storage-cleanup", "library", "library-stats", "scene-media", "media"]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
