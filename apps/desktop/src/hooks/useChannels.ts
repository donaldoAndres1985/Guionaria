import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Channel, type ChannelInput } from "@/lib/api";

export function useChannels() {
  return useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
}

export function useSaveChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: ChannelInput }) =>
      id
        ? api.patch<Channel>(`/api/channels/${id}`, data)
        : api.post<Channel>("/api/channels", data),
    onSuccess: (saved) => {
      // Se inserta ya en la caché para que la selección no salte mientras se recarga la lista.
      client.setQueryData<Channel[]>(["channels"], (old = []) =>
        old.some((c) => c.id === saved.id)
          ? old.map((c) => (c.id === saved.id ? saved : c))
          : [...old, saved],
      );
      void client.invalidateQueries({ queryKey: ["channels"] });
      // El nombre del canal aparece en los proyectos.
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/channels/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["channels"] }),
  });
}
