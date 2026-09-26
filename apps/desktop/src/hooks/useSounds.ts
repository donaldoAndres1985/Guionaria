import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type FreesoundPage,
  type FreesoundResult,
  type SceneSounds,
  type Sound,
  type SoundKind,
} from "@/lib/api";

export function useSounds(filters: { kind?: SoundKind | null; q?: string; tag?: string | null }) {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.tag) params.set("tag", filters.tag);
  const qs = params.toString();
  return useQuery({
    queryKey: ["sounds", filters],
    queryFn: () => api.get<Sound[]>(`/api/sounds${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });
}

export function useSoundTags(kind: SoundKind) {
  return useQuery({
    queryKey: ["sound-tags", kind],
    queryFn: () => api.get<{ tag: string; count: number }[]>(`/api/sounds/tags?kind=${kind}`),
  });
}

function useInvalidateSounds() {
  const client = useQueryClient();
  return () => {
    for (const key of ["sounds", "sound-tags", "scene-sounds", "sound-suggestions", "timeline"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useUploadSounds() {
  const invalidate = useInvalidateSounds();
  return useMutation({
    mutationFn: async ({ files, kind }: { files: File[]; kind: SoundKind }) => {
      const added: Sound[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("kind", kind);
        added.push(...(await api.upload<Sound[]>("/api/sounds:upload", form)));
      }
      return added;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateSound() {
  const invalidate = useInvalidateSounds();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; tags?: string[]; mood?: string | null; bpm?: number | null }) =>
      api.patch<Sound>(`/api/sounds/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteSound() {
  const invalidate = useInvalidateSounds();
  return useMutation({ mutationFn: (id: number) => api.del(`/api/sounds/${id}`), onSuccess: invalidate });
}

export function useFreesoundSearch(query: string, page: number) {
  return useQuery({
    queryKey: ["freesound", query, page],
    queryFn: () => api.get<FreesoundPage>(`/api/freesound/search?q=${encodeURIComponent(query)}&page=${page}`),
    enabled: query.trim().length > 0,
    retry: false,
  });
}

export function useSaveFreesound() {
  const client = useQueryClient();
  const invalidate = useInvalidateSounds();
  return useMutation({
    mutationFn: ({ result, kind }: { result: FreesoundResult; kind: SoundKind }) =>
      api.post<Sound>("/api/freesound:save", { result, kind }),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: ["freesound"] });
    },
  });
}

export function useSceneSounds(sceneId: number | null) {
  return useQuery({
    queryKey: ["scene-sounds", sceneId],
    queryFn: () => api.get<SceneSounds>(`/api/scenes/${sceneId}/sounds`),
    enabled: sceneId != null,
  });
}

export function useSoundSuggestions(sceneId: number | null, role: SoundKind, enabled: boolean) {
  return useQuery({
    queryKey: ["sound-suggestions", sceneId, role],
    queryFn: () => api.get<Sound[]>(`/api/scenes/${sceneId}/sounds/suggestions?role=${role}`),
    enabled: enabled && sceneId != null,
  });
}

export function useAssignSound() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, role, soundId }: { sceneId: number; role: SoundKind; soundId: number | null }) =>
      api.put<SceneSounds>(`/api/scenes/${sceneId}/sounds`, { role, sound_id: soundId }),
    onSuccess: (result) => {
      client.setQueryData(["scene-sounds", result.scene_id], result);
      for (const key of ["sounds", "timeline", "scenes"]) void client.invalidateQueries({ queryKey: [key] });
    },
  });
}
