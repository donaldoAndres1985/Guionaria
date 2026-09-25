import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type LibraryFilters, type LibraryPage, type LibraryStats, type SceneMedia } from "@/lib/api";
import { mediaKeys } from "./useMedia";

export function libraryQuery(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    params.set(key, String(value).trim());
  }
  const qs = params.toString();
  return `/api/library${qs ? `?${qs}` : ""}`;
}

export function useLibrary(filters: LibraryFilters, enabled = true) {
  return useQuery({
    queryKey: ["library", filters],
    queryFn: () => api.get<LibraryPage>(libraryQuery(filters)),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useLibraryStats() {
  return useQuery({ queryKey: ["library-stats"], queryFn: () => api.get<LibraryStats>("/api/library/stats") });
}

/** Usa un medio de la biblioteca en una escena (enlace duro: no ocupa espacio de nuevo). */
export function useReuseAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, sceneId }: { assetId: number; sceneId: number }) =>
      api.post<SceneMedia>(`/api/library/${assetId}:reuse`, { scene_id: sceneId }),
    onSuccess: (media) => {
      client.setQueryData(mediaKeys.scene(media.scene_id), media);
      void client.invalidateQueries({ queryKey: ["media"] });
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["library-stats"] });
    },
  });
}
