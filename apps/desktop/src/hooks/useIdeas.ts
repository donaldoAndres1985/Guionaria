import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Idea, type IdeaInput, type IdeaStatus, type Project, type ProjectFormat } from "@/lib/api";

export function useIdeas(filters: { channel?: number | null; status?: IdeaStatus | null } = {}) {
  const params = new URLSearchParams();
  if (filters.channel) params.set("channel", String(filters.channel));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return useQuery({
    queryKey: ["ideas", filters.channel ?? null, filters.status ?? null],
    queryFn: () => api.get<Idea[]>(`/api/ideas${qs ? `?${qs}` : ""}`),
  });
}

function useInvalidateIdeas() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ["ideas"] });
}

export function useCreateIdea() {
  const invalidate = useInvalidateIdeas();
  return useMutation({ mutationFn: (data: IdeaInput) => api.post<Idea>("/api/ideas", data), onSuccess: invalidate });
}

export function useUpdateIdea() {
  const invalidate = useInvalidateIdeas();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Omit<Idea, "id">> & { id: number }) =>
      api.patch<Idea>(`/api/ideas/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteIdea() {
  const invalidate = useInvalidateIdeas();
  return useMutation({ mutationFn: (id: number) => api.del(`/api/ideas/${id}`), onSuccess: invalidate });
}

export function useConvertIdea() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; format: ProjectFormat; target_duration_s: number | null; target_publish_at: string | null }) =>
      api.post<Project>(`/api/ideas/${id}:convert`, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ideas"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
