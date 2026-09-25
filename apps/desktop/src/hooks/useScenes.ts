import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type Scene, type ScenesState, type SceneUpdate } from "@/lib/api";

const base = (pid: number) => `/api/projects/${pid}/scenes`;
const key = (pid: number) => ["scenes", pid] as const;

export function useScenes(projectId: number) {
  return useQuery({ queryKey: key(projectId), queryFn: () => api.get<ScenesState>(base(projectId)) });
}

function useSetScenes(projectId: number) {
  const client = useQueryClient();
  return (state: ScenesState) => client.setQueryData(key(projectId), state);
}

/** Edición de una celda: se ve al instante y se revierte si el núcleo la rechaza. */
export function useUpdateScene(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SceneUpdate }) =>
      api.patch<Scene>(`/api/scenes/${id}`, data),
    onMutate: async ({ id, data }) => {
      await client.cancelQueries({ queryKey: key(projectId) });
      const previous = client.getQueryData<ScenesState>(key(projectId));
      if (previous) {
        client.setQueryData<ScenesState>(key(projectId), {
          ...previous,
          scenes: previous.scenes.map((s) => (s.id === id ? { ...s, ...data } : s)),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(key(projectId), context.previous);
    },
    onSuccess: (scene) => {
      client.setQueryData<ScenesState>(key(projectId), (old) =>
        old ? { ...old, scenes: old.scenes.map((s) => (s.id === scene.id ? scene : s)) } : old,
      );
    },
    // Contadores (por revisar, etc.) los recalcula el núcleo.
    onSettled: () => client.invalidateQueries({ queryKey: key(projectId) }),
  });
}

/** Reordenar: el orden cambia al soltar; los tiempos llegan recalculados del núcleo. */
export function useReorderScenes(projectId: number) {
  const client = useQueryClient();
  const setScenes = useSetScenes(projectId);
  return useMutation({
    mutationFn: (sceneIds: number[]) =>
      api.post<ScenesState>(`${base(projectId)}:reorder`, { scene_ids: sceneIds }),
    onMutate: async (sceneIds) => {
      await client.cancelQueries({ queryKey: key(projectId) });
      const previous = client.getQueryData<ScenesState>(key(projectId));
      if (previous) {
        const byId = new Map(previous.scenes.map((s) => [s.id, s]));
        client.setQueryData<ScenesState>(key(projectId), {
          ...previous,
          scenes: sceneIds.map((id, i) => ({ ...byId.get(id)!, position: i + 1 })),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(key(projectId), context.previous);
    },
    onSuccess: setScenes,
  });
}

export type SceneAction = "split" | "duplicate" | "delete" | "reviewed";

export function useSceneAction(projectId: number) {
  const client = useQueryClient();
  const setScenes = useSetScenes(projectId);
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: SceneAction }) => {
      if (action === "delete") return api.del<ScenesState>(`/api/scenes/${id}`);
      if (action === "reviewed") {
        await api.post<Scene>(`/api/scenes/${id}:reviewed`, {});
        return null;
      }
      return api.post<ScenesState>(`/api/scenes/${id}:${action}`, {});
    },
    onSuccess: (state) => {
      if (state) setScenes(state);
      else void client.invalidateQueries({ queryKey: key(projectId) });
    },
  });
}

export function useGenerateScenes(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mode: "all" | "pending") => api.post<Job>(`${base(projectId)}:generate`, { mode }),
    onSuccess: (job) => {
      client.setQueryData(["job", job.id], job);
      client.setQueryData<Job[]>(["active-jobs", projectId], (old = []) => [job, ...old]);
    },
  });
}

function useProjectStateChange(projectId: number) {
  const client = useQueryClient();
  const setScenes = useSetScenes(projectId);
  return (state: ScenesState) => {
    setScenes(state);
    void client.invalidateQueries({ queryKey: ["project", projectId] });
    void client.invalidateQueries({ queryKey: ["projects"] });
  };
}

export function useApproveScenes(projectId: number) {
  const onChange = useProjectStateChange(projectId);
  return useMutation({
    mutationFn: () => api.post<ScenesState>(`${base(projectId)}:approve`, {}),
    onSuccess: onChange,
  });
}

export function useUnlockScenes(projectId: number) {
  const onChange = useProjectStateChange(projectId);
  return useMutation({
    mutationFn: () => api.post<ScenesState>(`${base(projectId)}:unlock`, {}),
    onSuccess: onChange,
  });
}

export function useExportScenes(projectId: number) {
  return useMutation({
    mutationFn: (format: "md" | "csv") =>
      api.post<{ format: string; path: string }>(`${base(projectId)}:export?format=${format}`, {}),
  });
}
