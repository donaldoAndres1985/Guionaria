import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type OverlayItem, type OverlayTrack, type OverlayTrackKind, type TextOverlayStyle, type TimelineState } from "@/lib/api";
import { timelineKey } from "./useTimeline";
import { transitionsKey } from "./useTransitions";

export interface ItemInput {
  start_s?: number;
  duration_s?: number;
  text?: string;
  style?: TextOverlayStyle;
  sound_id?: number;
  volume?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  track_id?: number;
}

/**
 * Edición del timeline (pistas propias, sus elementos y el efecto de cada escena). Los cambios
 * se ven al momento en el timeline (caché) y la vista previa se vuelve a pedir al núcleo.
 */
export function useOverlayEditing(projectId: number) {
  const client = useQueryClient();
  const key = timelineKey(projectId);
  const refresh = () => void client.invalidateQueries({ queryKey: key });
  const patchTracks = (fn: (tracks: OverlayTrack[]) => OverlayTrack[]) =>
    client.setQueryData<TimelineState>(key, (old) => (old ? { ...old, overlay_tracks: fn(old.overlay_tracks ?? []) } : old));
  const putItem = (item: OverlayItem) =>
    patchTracks((tracks) =>
      tracks.map((t) => ({
        ...t,
        items: [...t.items.filter((i) => i.id !== item.id), ...(t.id === item.track_id ? [item] : [])].sort(
          (a, b) => a.start_s - b.start_s,
        ),
      })),
    );

  const addTrack = useMutation({
    mutationFn: (kind: OverlayTrackKind) => api.post<OverlayTrack>(`/api/projects/${projectId}/overlay-tracks`, { kind }),
    onSuccess: (track) => {
      patchTracks((tracks) => [...tracks, track]);
      refresh();
    },
  });
  const renameTrack = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.patch<OverlayTrack>(`/api/overlay-tracks/${id}`, { name }),
    onSuccess: (track) => patchTracks((tracks) => tracks.map((t) => (t.id === track.id ? track : t))),
  });
  const deleteTrack = useMutation({
    mutationFn: (id: number) => api.del(`/api/overlay-tracks/${id}`),
    onSuccess: (_r, id) => {
      patchTracks((tracks) => tracks.filter((t) => t.id !== id));
      refresh();
    },
  });
  const addItem = useMutation({
    mutationFn: ({ trackId, input }: { trackId: number; input: ItemInput }) =>
      api.post<OverlayItem>(`/api/overlay-tracks/${trackId}/items`, input),
    onSuccess: (item) => {
      putItem(item);
      refresh();
    },
  });
  const updateItem = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ItemInput }) => api.patch<OverlayItem>(`/api/overlay-items/${id}`, input),
    // Se mueve al instante (arrastrar no debe saltar mientras responde el núcleo).
    onMutate: ({ id, input }) =>
      patchTracks((tracks) => {
        const item = tracks.flatMap((t) => t.items).find((i) => i.id === id);
        if (!item) return tracks;
        const next = { ...item, ...input } as OverlayItem;
        return tracks.map((t) => ({
          ...t,
          items: [...t.items.filter((i) => i.id !== id), ...(t.id === next.track_id ? [next] : [])].sort((a, b) => a.start_s - b.start_s),
        }));
      }),
    onSuccess: (item) => putItem(item),
    onSettled: refresh,
  });
  const deleteItem = useMutation({
    mutationFn: (id: number) => api.del(`/api/overlay-items/${id}`),
    onSuccess: (_r, id) => {
      patchTracks((tracks) => tracks.map((t) => ({ ...t, items: t.items.filter((i) => i.id !== id) })));
      refresh();
    },
  });
  const duplicateItem = useMutation({
    mutationFn: (id: number) => api.post<OverlayItem>(`/api/overlay-items/${id}:duplicate`, {}),
    onSuccess: (item) => {
      putItem(item);
      refresh();
    },
  });
  const setEffect = useMutation({
    mutationFn: ({ sceneId, effect }: { sceneId: number; effect: string }) =>
      api.put<{ scene_id: number; effect: string | null }>(`/api/scenes/${sceneId}/effect`, { effect }),
    onSuccess: (r) => {
      client.setQueryData<TimelineState>(key, (old) =>
        old ? { ...old, scenes: old.scenes.map((s) => (s.scene_id === r.scene_id ? { ...s, effect: r.effect === "ninguno" ? null : r.effect } : s)) } : old,
      );
      refresh();
      void client.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });
  /** Transición de un corte y/o su duración (undefined: no cambia; null: la de por defecto). */
  const setCut = useMutation({
    mutationFn: ({ sceneId, transition, duration_s }: { sceneId: number; transition?: string | null; duration_s?: number | null }) => {
      const body: Record<string, unknown> = {};
      if (transition !== undefined) body.transition = transition;
      if (duration_s !== undefined) body.duration_s = duration_s;
      return api.put(`/api/scenes/${sceneId}/transition`, body);
    },
    onSuccess: (state) => {
      client.setQueryData(transitionsKey(projectId), state);
      refresh();
    },
  });

  return { addTrack, renameTrack, deleteTrack, addItem, updateItem, deleteItem, duplicateItem, setEffect, setCut };
}

export type OverlayEditing = ReturnType<typeof useOverlayEditing>;
