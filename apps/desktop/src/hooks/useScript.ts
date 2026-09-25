import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  api,
  type Job,
  type RewriteResult,
  type Script,
  type ScriptVersionSummary,
  type SegmentInput,
} from "@/lib/api";

const base = (pid: number) => `/api/projects/${pid}/script`;

/** null = el proyecto todavía no tiene guion. */
export function useScript(projectId: number) {
  return useQuery({
    queryKey: ["script", projectId],
    queryFn: async () => {
      try {
        return await api.get<Script>(base(projectId));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useScriptVersion(projectId: number, version: number | null) {
  return useQuery({
    queryKey: ["script", projectId, "version", version],
    queryFn: () => api.get<Script>(`${base(projectId)}?version=${version}`),
    enabled: version != null,
  });
}

export function useScriptVersions(projectId: number, enabled = true) {
  return useQuery({
    queryKey: ["script-versions", projectId],
    queryFn: () => api.get<ScriptVersionSummary[]>(`${base(projectId)}/versions`),
    enabled,
  });
}

function useOnScript(projectId: number) {
  const client = useQueryClient();
  return (script: Script) => {
    client.setQueryData(["script", projectId], script);
    for (const key of [["script-versions", projectId], ["project", projectId], ["projects"]]) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
}

export function useSaveScript(projectId: number) {
  const onScript = useOnScript(projectId);
  return useMutation({
    mutationFn: (segments: SegmentInput[]) => api.put<Script>(base(projectId), { segments }),
    onSuccess: onScript,
  });
}

export function useApproveScript(projectId: number) {
  const onScript = useOnScript(projectId);
  return useMutation({
    mutationFn: () => api.post<Script>(`${base(projectId)}:approve`, {}),
    onSuccess: onScript,
  });
}

export function useUnlockScript(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ scenes_to_review: number }>(`${base(projectId)}:unlock`, {}),
    onSuccess: () => {
      for (const key of [["script", projectId], ["project", projectId], ["projects"]]) {
        void client.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useRestoreVersion(projectId: number) {
  const onScript = useOnScript(projectId);
  return useMutation({
    mutationFn: (version: number) =>
      api.post<Script>(`${base(projectId)}/versions/${version}:restore`, {}),
    onSuccess: onScript,
  });
}

export function useGenerateScript(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>(`${base(projectId)}:generate`, {}),
    onSuccess: (job) => {
      client.setQueryData(["job", job.id], job);
      client.setQueryData<Job[]>(["active-jobs", projectId], (old = []) => [job, ...old]);
    },
  });
}

export function useRewrite(projectId: number) {
  return useMutation({
    mutationFn: (args: { segKey: string; instruccion: string; fragmento: string | null }) =>
      api.post<RewriteResult>(`${base(projectId)}/segments/${args.segKey}:rewrite`, {
        instruccion: args.instruccion,
        fragmento: args.fragmento,
      }),
  });
}
