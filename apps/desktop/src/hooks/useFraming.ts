import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type FramingInput, type FramingState, type Job } from "@/lib/api";
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
