import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Prompt } from "@/lib/api";

export function usePrompts() {
  return useQuery({ queryKey: ["prompts"], queryFn: () => api.get<Prompt[]>("/api/prompts") });
}

function useUpdatePromptCache() {
  const client = useQueryClient();
  return (saved: Prompt) =>
    client.setQueryData<Prompt[]>(["prompts"], (old = []) =>
      old.map((p) => (p.name === saved.name ? saved : p)),
    );
}

export function useSavePrompt() {
  const update = useUpdatePromptCache();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.put<Prompt>(`/api/prompts/${name}`, { content }),
    onSuccess: update,
  });
}

export function useResetPrompt() {
  const update = useUpdatePromptCache();
  return useMutation({
    mutationFn: (name: string) => api.post<Prompt>(`/api/prompts/${name}:reset`, {}),
    onSuccess: update,
  });
}
