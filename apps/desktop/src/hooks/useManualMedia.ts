import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type PackageResult, type SceneMedia } from "@/lib/api";
import { mediaKeys } from "./useMedia";

function useOnSceneMedia(projectId: number) {
  const client = useQueryClient();
  return (media: SceneMedia) => {
    client.setQueryData(mediaKeys.scene(media.scene_id), media);
    void client.invalidateQueries({ queryKey: mediaKeys.overview(projectId) });
  };
}

export type ImportSource =
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }
  | { kind: "file"; file: File };

/** Agrega un medio a mano: archivo local (arrastrado), URL o archivo pegado/soltado. */
export function useImportMedia(projectId: number) {
  const onScene = useOnSceneMedia(projectId);
  return useMutation({
    mutationFn: ({ sceneId, source, candidateId }: { sceneId: number; source: ImportSource; candidateId?: number }) => {
      if (source.kind === "file") {
        const form = new FormData();
        form.append("file", source.file, source.file.name || "pegado.png");
        if (candidateId != null) form.append("candidate_id", String(candidateId));
        return api.upload<SceneMedia>(`/api/scenes/${sceneId}/assets:upload`, form);
      }
      return api.post<SceneMedia>(`/api/scenes/${sceneId}/assets:import`, {
        ...(source.kind === "path" ? { path: source.path } : { url: source.url }),
        candidate_id: candidateId ?? null,
      });
    },
    onSuccess: onScene,
  });
}

export function useOpenUrl() {
  return useMutation({ mutationFn: (url: string) => api.post<void>("/api/system/open-url", { url }) });
}

export function useRevealAsset() {
  return useMutation({ mutationFn: (assetId: number) => api.post<void>(`/api/assets/${assetId}:reveal`, {}) });
}

export function useRevealProject() {
  return useMutation({ mutationFn: (projectId: number) => api.post<void>(`/api/projects/${projectId}:reveal`, {}) });
}

export function useExportPackage(projectId: number) {
  return useMutation({
    mutationFn: () => api.post<PackageResult>(`/api/projects/${projectId}:export-package`, {}),
  });
}

/** Video de YouTube, noticias o redes con yt-dlp (en segundo plano). */
export function useVideoFromUrl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, url, startS, endS }: { sceneId: number; url: string; startS: number | null; endS: number | null }) =>
      api.post<Job>(`/api/scenes/${sceneId}/assets:video-url`, { url, start_s: startS, end_s: endS }),
    onSuccess: (job) => client.setQueryData(["job", job.id], job),
  });
}
