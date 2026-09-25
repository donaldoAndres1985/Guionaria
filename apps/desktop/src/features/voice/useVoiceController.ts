import { useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectJob } from "@/hooks/useProjectJob";
import { type VoiceAction, useUploadVoice, useVoiceJob, useVoiceState } from "@/hooks/useVoice";
import type { Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";

export function useVoiceController(project: Project) {
  const { data: state, dataUpdatedAt } = useVoiceState(project.id);
  const mutation = useVoiceJob(project.id);
  const upload = useUploadVoice(project.id);
  const action = useRef<VoiceAction>({ kind: "transcribe" });
  const job = useProjectJob(
    project.id,
    "voice",
    () => mutation.mutateAsync(action.current),
    (done) => {
      const r = done.result ?? {};
      if (typeof r.words === "number") toast.success(`Tiempos alineados con ${r.words} palabras`);
      else toast.success(`Voz lista · ${formatDuration(r.duration_s as number | undefined)}`);
    },
  );

  // Ajustes elegidos en pantalla; si no se tocan, los de la última voz o los por defecto.
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [pause, setPause] = useState(0.3);

  const run = (a: VoiceAction) => {
    action.current = a;
    void job.start();
  };
  const selectedVoice = voiceId ?? state?.voice_id ?? state?.default_voice ?? null;
  const selectedSpeed = speed ?? state?.speed ?? 1;

  return {
    state,
    /** Cambia cuando se vuelve a leer el estado: fuerza a recargar el audio. */
    version: dataUpdatedAt,
    job: job.job,
    running: job.running,
    error: job.error,
    dismissError: job.dismissError,
    voiceId: selectedVoice,
    setVoiceId,
    speed: selectedSpeed,
    setSpeed,
    pause,
    setPause,
    generate: () => run({ kind: "generate", input: { voice_id: selectedVoice, speed: selectedSpeed, pause_s: pause } }),
    regenerate: (segKey: string) => run({ kind: "regenerate", segKey }),
    transcribe: () => run({ kind: "transcribe" }),
    upload: (file: File) =>
      upload.mutate(file, { onSuccess: () => toast.success("Voz grabada subida: ahora transcríbela con Whisper") }),
    uploading: upload.isPending,
  };
}

export type VoiceController = ReturnType<typeof useVoiceController>;
