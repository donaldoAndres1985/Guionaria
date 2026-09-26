import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type ElevenAccount,
  type ElevenLabsPrefs,
  type ElevenModel,
  type ElevenVoice,
  type Job,
  type VoiceInfo,
  type VoiceState,
} from "@/lib/api";

export const voiceKeys = {
  state: (projectId: number) => ["voice", projectId] as const,
  voices: ["voices"] as const,
};

export function useVoiceState(projectId: number) {
  return useQuery({
    queryKey: voiceKeys.state(projectId),
    queryFn: () => api.get<VoiceState>(`/api/projects/${projectId}/voice`),
  });
}

/** Voces en español de Piper (catálogo oficial, con respaldo sin conexión). */
export function useVoices() {
  return useQuery({
    queryKey: voiceKeys.voices,
    queryFn: () => api.get<VoiceInfo[]>("/api/voice/voices"),
    staleTime: 10 * 60_000,
  });
}

export interface GenerateVoiceInput {
  voice_id: string | null;
  speed: number;
  pause_s: number;
  engine?: "piper" | "elevenlabs";
  elevenlabs?: Omit<ElevenLabsPrefs, "voice_name"> | null;
}

/** Voces de la cuenta de ElevenLabs (propias, clonadas y de la biblioteca). */
export function useElevenVoices(enabled: boolean) {
  return useQuery({
    queryKey: ["elevenlabs", "voices"],
    queryFn: () => api.get<ElevenVoice[]>("/api/voice/elevenlabs/voices"),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useElevenModels(enabled: boolean) {
  return useQuery({
    queryKey: ["elevenlabs", "models"],
    queryFn: () => api.get<ElevenModel[]>("/api/voice/elevenlabs/models"),
    enabled,
    staleTime: Infinity,
  });
}

/** Créditos del mes: se vuelven a leer después de generar. */
export function useElevenAccount(enabled: boolean) {
  return useQuery({
    queryKey: ["elevenlabs", "account"],
    queryFn: () => api.get<ElevenAccount>("/api/voice/elevenlabs/account"),
    enabled,
    retry: false,
  });
}

export function useRevealSubtitles(projectId: number) {
  return useMutation({
    mutationFn: (name: "voz.srt" | "voz.vtt") =>
      api.post<void>(`/api/projects/${projectId}/voice/subtitles/${name}:reveal`, {}),
  });
}

export type VoiceAction =
  | { kind: "generate"; input: GenerateVoiceInput }
  | { kind: "regenerate"; segKey: string }
  | { kind: "transcribe" };

/** Generar, regenerar un segmento o transcribir: todos son trabajos "voice" del proyecto. */
export function useVoiceJob(projectId: number) {
  const client = useQueryClient();
  const base = `/api/projects/${projectId}/voice`;
  return useMutation({
    mutationFn: (action: VoiceAction) =>
      action.kind === "generate"
        ? api.post<Job>(`${base}:generate`, action.input)
        : action.kind === "regenerate"
          ? api.post<Job>(`${base}/segments/${action.segKey}:regenerate`, {})
          : api.post<Job>(`${base}:transcribe`, {}),
    onSuccess: (job) => client.setQueryData(["job", job.id], job),
  });
}

export function useUploadVoice(projectId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return api.upload<VoiceState>(`/api/projects/${projectId}/voice:upload`, form);
    },
    onSuccess: (state) => {
      client.setQueryData(voiceKeys.state(projectId), state);
      void client.invalidateQueries({ queryKey: ["scenes", projectId] });
    },
  });
}
