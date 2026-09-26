import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings, type Health, type KeyProvider, type KeyTestResult } from "@/lib/api";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<Health>("/api/health"),
    refetchInterval: (query) => (query.state.status === "error" ? 2_000 : 15_000),
    retry: false,
  });
}

export function useRefreshDependencies() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<Health>("/api/health?refresh=true"),
    onSuccess: (data) => client.setQueryData(["health"], data),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<AppSettings>("/api/settings"),
  });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => api.put<AppSettings>("/api/settings", settings),
    onSuccess: (data) => {
      client.setQueryData(["settings"], data);
      // La URL de SearXNG puede haber cambiado.
      void client.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

/** Prueba una clave (o la URL de SearXNG) antes de guardarla. */
export function useTestKey(provider: KeyProvider) {
  return useMutation({
    mutationFn: (value: string) =>
      api.post<KeyTestResult>(`/api/settings/keys/${provider}:test`, { value }),
  });
}
