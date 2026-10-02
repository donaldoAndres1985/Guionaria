import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CleanablePart, type CleanupPreview, type StorageUsage } from "@/lib/api";

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

/** Limpieza completa: borra render, aprobados, voz, timeline o lo agregado a mano de proyectos
 * ya terminados (sección 5.11), a pedido del usuario. */
export function useCleanupMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectIds, parts }: { projectIds: number[]; parts: CleanablePart[] }) =>
      api.post<{ deleted: number; freed_bytes: number }>("/api/storage/cleanup/media", {
        project_ids: projectIds,
        parts,
      }),
    onSuccess: () => {
      for (const key of [
        "storage-usage",
        "storage-cleanup",
        "library",
        "library-stats",
        "scene-media",
        "media",
        "timeline",
        "publishing",
        "project",
        "projects",
      ]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
