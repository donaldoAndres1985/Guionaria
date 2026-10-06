import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type BackupResult,
  type BackupStatus,
  type CleanablePart,
  type CleanupPreview,
  type StorageUsage,
} from "@/lib/api";

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
    mutationFn: ({ projectIds, parts, backup = false }: { projectIds: number[]; parts: CleanablePart[]; backup?: boolean }) =>
      api.post<{ deleted: number; freed_bytes: number }>("/api/storage/cleanup/media", {
        project_ids: projectIds,
        parts,
        backup,
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

/** Estado de la carpeta de copia de seguridad; con `folder`, prueba otra sin guardarla. */
export function useBackupStatus(folder?: string) {
  const query = folder === undefined ? "" : `?folder=${encodeURIComponent(folder)}`;
  return useQuery({
    queryKey: ["storage-backup", folder ?? null],
    queryFn: () => api.get<BackupStatus>(`/api/storage/backup${query}`),
  });
}

/** Copia el video final y la portada de los proyectos a la carpeta de respaldo. */
export function useBackupProjects() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (projectIds: number[]) => api.post<BackupResult>("/api/storage/backup", { project_ids: projectIds }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["storage-backup"] });
      void client.invalidateQueries({ queryKey: ["history"] });
    },
  });
}
