import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectJob } from "@/hooks/useProjectJob";
import { type VoiceAction, useSaveElevenPreset, useUploadVoice, useVoiceJob, useVoiceState } from "@/hooks/useVoice";
import type { ElevenLabsPrefs, Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";

export function useVoiceController(project: Project) {
  const { data: state, dataUpdatedAt } = useVoiceState(project.id);
  const mutation = useVoiceJob(project.id);
  const upload = useUploadVoice(project.id);
  const action = useRef<VoiceAction>({ kind: "transcribe" });
  const queryClient = useQueryClient();
  const job = useProjectJob(
    project.id,
    "voice",
    () => mutation.mutateAsync(action.current),
    (done) => {
      // Los créditos de ElevenLabs cambian tras generar.
      void queryClient.invalidateQueries({ queryKey: ["elevenlabs", "account"] });
      const r = done.result ?? {};
      if (typeof r.words === "number") toast.success(`Tiempos alineados con ${r.words} palabras`);
      else toast.success(`Voz lista · ${formatDuration(r.duration_s as number | undefined)}`);
    },
  );

  // Ajustes elegidos en pantalla; si no se tocan, los de la última voz o los por defecto.
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [pause, setPause] = useState(0.3);
  const [engineChoice, setEngine] = useState<"piper" | "elevenlabs" | null>(null);
  const [elevenPatch, setElevenPatch] = useState<Partial<ElevenLabsPrefs>>({});
  const savePreset = useSaveElevenPreset(project.id);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const run = (a: VoiceAction) => {
    action.current = a;
    void job.start();
  };
  const selectedVoice = voiceId ?? state?.voice_id ?? state?.default_voice ?? null;
  const selectedSpeed = speed ?? state?.speed ?? 1;
  // Sin elegir en pantalla: el motor por defecto de Ajustes (el último usado).
  const engine =
    engineChoice ?? state?.default_engine ?? (state?.source === "elevenlabs" ? "elevenlabs" : "piper");
  const eleven: ElevenLabsPrefs | null = state ? { ...state.elevenlabs, ...elevenPatch } : null;
  const characters = state?.segments.reduce((n, s) => n + s.text.length, 0) ?? 0;
  const canGenerate = engine === "piper" || (!!state?.elevenlabs_configured && !!eleven?.voice_id);

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
    engine,
    setEngine,
    eleven,
    setEleven: (patch: Partial<ElevenLabsPrefs>) => {
      if (!eleven) return;
      if (patch.voice_id && patch.voice_id !== eleven.voice_id) {
        // Otra voz: vuelven sus ajustes guardados (modelo, estabilidad, similitud, estilo, velocidad).
        const preset = state?.elevenlabs_presets?.[patch.voice_id];
        setElevenPatch((p) => ({ ...p, ...(preset ?? {}), ...patch }));
        return;
      }
      const next = { ...eleven, ...patch };
      setElevenPatch((p) => ({ ...p, ...patch }));
      if (!next.voice_id) return;
      // Cambió un ajuste: se guarda para esa voz (con una pausa para no guardar cada paso del control).
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => savePreset.mutate(next), 600);
    },
    characters,
    canGenerate,
    generate: () =>
      run({
        kind: "generate",
        input:
          engine === "elevenlabs" && eleven
            ? {
                voice_id: null,
                speed: eleven.speed,
                pause_s: pause,
                engine,
                elevenlabs: {
                  voice_id: eleven.voice_id,
                  voice_name: eleven.voice_name,
                  model_id: eleven.model_id,
                  stability: eleven.stability,
                  similarity_boost: eleven.similarity_boost,
                  style: eleven.style,
                  speed: eleven.speed,
                },
              }
            : { voice_id: selectedVoice, speed: selectedSpeed, pause_s: pause, engine: "piper" },
      }),
    regenerate: (segKey: string) => run({ kind: "regenerate", segKey }),
    transcribe: () => run({ kind: "transcribe" }),
    upload: (file: File) =>
      upload.mutate(file, { onSuccess: () => toast.success("Voz grabada subida: ahora transcríbela con Whisper") }),
    uploading: upload.isPending,
  };
}

export type VoiceController = ReturnType<typeof useVoiceController>;
