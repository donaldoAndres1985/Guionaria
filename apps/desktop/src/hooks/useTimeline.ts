import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TimelineExport, type TimelineFormat, type TimelineState } from "@/lib/api";

export const timelineKey = (projectId: number) => ["timeline", projectId] as const;

export function useTimeline(projectId: number) {
  return useQuery({
    queryKey: timelineKey(projectId),
    queryFn: () => api.get<TimelineState>(`/api/projects/${projectId}/timeline`),
  });
}

/** Escribe timeline/proyecto.otio, .fcpxml y .edl (por defecto, los tres). */
export function useExportTimeline(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (formats?: TimelineFormat[]) =>
      api.post<TimelineExport>(`/api/projects/${projectId}/timeline:export`, { formats: formats ?? null }),
    onSuccess: (result) => {
      client.setQueryData(timelineKey(projectId), result.state);
      void client.invalidateQueries({ queryKey: ["project", projectId] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
