import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TransitionsState } from "@/lib/api";
import { timelineKey } from "./useTimeline";

export const transitionsKey = (projectId: number) => ["transitions", projectId] as const;

export function useTransitions(projectId: number) {
  return useQuery({
    queryKey: transitionsKey(projectId),
    queryFn: () => api.get<TransitionsState>(`/api/projects/${projectId}/transitions`),
  });
}

/** Guarda la transición por defecto, su duración o «aplicar a todos»; refresca la vista previa. */
export function useSaveTransitions(projectId: number) {
  const client = useQueryClient();
  const done = (state: TransitionsState) => {
    client.setQueryData(transitionsKey(projectId), state);
    void client.invalidateQueries({ queryKey: [...timelineKey(projectId), "preview"] });
  };
  const prefs = useMutation({
    mutationFn: (body: { default?: string; duration?: number; reset_cuts?: boolean }) =>
      api.put<TransitionsState>(`/api/projects/${projectId}/transitions`, body),
    onSuccess: done,
  });
  const cut = useMutation({
    mutationFn: ({ sceneId, transition }: { sceneId: number; transition: string | null }) =>
      api.put<TransitionsState>(`/api/scenes/${sceneId}/transition`, { transition }),
    onSuccess: done,
  });
  return { prefs, cut };
}
