import { AudioLines, LoaderCircle, Mic } from "lucide-react";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/project";
import type { VoiceController } from "./useVoiceController";
import { primaryAction, timingLabel } from "./voiceMeta";

export function VoiceBottomBar({ ctl }: { ctl: VoiceController }) {
  const { state } = ctl;
  const action = primaryAction(state);
  const stats = [
    { label: "Duración de la voz", value: formatDuration(state?.duration_s), highlight: true },
    { label: "Tiempos de las escenas", value: timingLabel(state) },
    { label: "Subtítulos", value: state?.subtitles.length ? "SRT · VTT" : "—" },
  ];
  const disabled = action === "none" || ctl.running || ctl.uploading;
  const engineName = ctl.engine === "elevenlabs" ? "ElevenLabs" : "Piper";
  const again = state?.source === ctl.engine;

  return (
    <BottomBar stats={stats}>
      {state?.source === "recorded" && (
        <Button
          variant={action === "transcribe" ? "default" : "outline"}
          size={action === "transcribe" ? "lg" : "default"}
          disabled={disabled}
          onClick={ctl.transcribe}
        >
          {ctl.running ? <LoaderCircle className="animate-spin" /> : <Mic />}
          {state.timing_source && !state.stale ? "Transcribir otra vez" : "Transcribir con Whisper"}
        </Button>
      )}
      <Button
        variant={action === "generate" ? "default" : "outline"}
        size={action === "generate" ? "lg" : "default"}
        className={action === "generate" ? "min-w-40" : undefined}
        disabled={disabled || !ctl.canGenerate}
        title={ctl.canGenerate ? undefined : "Elige una voz de ElevenLabs (y agrega la clave en Ajustes)"}
        onClick={ctl.generate}
      >
        {ctl.running && action === "generate" ? <LoaderCircle className="animate-spin" /> : <AudioLines />}
        {again ? `Generar otra vez con ${engineName}` : `Generar voz con ${engineName}`}
      </Button>
    </BottomBar>
  );
}
