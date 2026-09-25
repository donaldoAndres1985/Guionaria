import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project, type ProjectInput, type ProjectUpdate } from "@/lib/api";

export function useProjects(filters: { channel?: number | null; q?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.channel) params.set("channel", String(filters.channel));
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const qs = params.toString();
  return useQuery({
    queryKey: ["projects", filters.channel ?? null, filters.q?.trim() ?? ""],
    queryFn: () => api.get<Project[]>(`/api/projects${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(`/api/projects/${id}`),
  });
}

function useInvalidateProjects() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["projects"] });
    void client.invalidateQueries({ queryKey: ["channels"] }); // contadores por canal
  };
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (data: ProjectInput) => api.post<Project>("/api/projects", data),
    onSuccess: invalidate,
  });
}

export function useUpdateProject(id: number) {
  const client = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (data: ProjectUpdate) => api.patch<Project>(`/api/projects/${id}`, data),
    onSuccess: (project) => {
      client.setQueryData(["project", id], project);
      invalidate();
    },
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/projects/${id}`),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: ["project", id] });
      invalidate();
    },
  });
}

/** Cambia la fecha de publicación (arrastrar en el calendario) de cualquier proyecto. */
export function useRescheduleProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: number; date: string | null }) =>
      api.patch<Project>(`/api/projects/${id}`, { target_publish_at: date }),
    onSuccess: (project) => {
      client.setQueryData(["project", project.id], project);
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** Etapas finales hechas fuera de la app (arrastrar en el tablero). */
export function useSetProjectStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Project["status"] }) =>
      api.post<Project>(`/api/projects/${id}:set-status`, { status }),
    onSuccess: (project) => {
      client.setQueryData(["project", project.id], project);
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
