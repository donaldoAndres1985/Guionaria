import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ExtendedFraming, type FramingInput, type FramingState, type Job } from "@/lib/api";
import { mediaKeys } from "./useMedia";

export function useFraming(sceneId: number, assetId: number | null) {
  return useQuery({
    queryKey: ["framing", sceneId, assetId],
    queryFn: () => api.get<FramingState>(`/api/scenes/${sceneId}/assets/${assetId}/framing`),
    enabled: assetId != null,
  });
}

/** Guarda el encuadre; los videos con recorte o fondo desenfocado devuelven un job. */
export function useSaveFraming(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, assetId, input }: { sceneId: number; assetId: number; input: FramingInput }) =>
      api.put<{ framing: FramingState; job: Job | null }>(
        `/api/scenes/${sceneId}/assets/${assetId}/framing`,
        input,
      ),
    onSuccess: (result, { sceneId, assetId }) => {
      client.setQueryData(["framing", sceneId, assetId], result.framing);
      if (result.job) client.setQueryData(["job", result.job.id], result.job);
      void client.invalidateQueries({ queryKey: mediaKeys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
  });
}

/**
 * «Continuar en la escena siguiente»: el video real dura más que la escena, así que el resto
 * del metraje pasa a la siguiente sin tocar narración ni voz (sección 5.6).
 */
export function useExtendToNextScene(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, assetId, input }: { sceneId: number; assetId: number; input: FramingInput }) =>
      api.post<ExtendedFraming>(`/api/scenes/${sceneId}/assets/${assetId}:extend-next`, input),
    onSuccess: (result, { sceneId, assetId }) => {
      client.setQueryData(["framing", sceneId, assetId], result.current);
      client.setQueryData(["framing", result.next_scene_id, result.next_asset_id], result.next);
      if (result.current_job) client.setQueryData(["job", result.current_job.id], result.current_job);
      if (result.next_job) client.setQueryData(["job", result.next_job.id], result.next_job);
      void client.invalidateQueries({ queryKey: mediaKeys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: mediaKeys.scene(result.next_scene_id) });
      void client.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
  });
}
