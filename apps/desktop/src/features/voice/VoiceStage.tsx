import { AudioLines, Captions, Mic, Play, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner, JobProgress, NoticeBanner } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import { useRevealSubtitles } from "@/hooks/useVoice";
import { coreUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ElevenLabsPanel } from "./ElevenLabsPanel";
import type { VoiceController } from "./useVoiceController";
import { PAUSES, SPEEDS, segmentAt, sourceLabel, speedLabel } from "./voiceMeta";
import { VoiceSelect } from "./VoiceSelect";
import { type SeekRequest, Waveform } from "./Waveform";

const AUDIO_ACCEPT = ".wav,.mp3,.m4a,.aac,.ogg,.flac";

export function VoiceStage({ ctl, onGoToScript }: { ctl: VoiceController; onGoToScript: () => void }) {
  const { state } = ctl;
  const fileInput = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const revealSubs = useRevealSubtitles(state?.project_id ?? 0);

  if (!state) return null;
  if (!state.can_edit) {
    return (
      <EmptyState
        icon={AudioLines}
        title="La voz se trabaja con el guion aprobado"
        description={state.reason ?? undefined}
        action={<Button onClick={onGoToScript}>Ir al guion</Button>}
      />
    );
  }

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
      <span className="text-[13px] font-medium">Voz</span>
      <span className="text-[12px] text-muted-foreground">{sourceLabel(state.source)}</span>
      <div className="ml-auto flex items-center gap-2">
        {state.subtitles.length > 0 && (
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <Captions className="size-4" /> Subtítulos:
            {state.subtitles.map((name) => (
              <Button
                key={name}
                size="xs"
                variant="ghost"
                title={`Abrir la carpeta con ${name} (para subirlo a YouTube o a tu editor)`}
                onClick={() => revealSubs.mutate(name as "voz.srt" | "voz.vtt")}
              >
                {name.endsWith(".srt") ? "SRT" : "VTT"}
              </Button>
            ))}
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={AUDIO_ACCEPT}
          className="hidden"
          data-testid="voice-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) ctl.upload(file);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={ctl.running || ctl.uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Upload /> Subir voz grabada
        </Button>
      </div>
    </div>
  );

  // Motor: Piper (gratis, local) o ElevenLabs (nube, opcional).
  const engineToggle = (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Motor de voz" className="inline-flex rounded-md border p-0.5">
        {(
          [
            { id: "piper", label: "Piper", hint: "Gratis · en tu equipo" },
            { id: "elevenlabs", label: "ElevenLabs", hint: "Profesional · en la nube" },
          ] as const
        ).map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={ctl.engine === e.id}
            disabled={ctl.running}
            onClick={() => ctl.setEngine(e.id)}
            className={cn(
              "rounded px-3 py-1.5 text-left text-[12px] transition-colors",
              ctl.engine === e.id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
            )}
          >
            <span className="block font-medium">{e.label}</span>
            <span className="block text-[11px] opacity-80">{e.hint}</span>
          </button>
        ))}
      </div>
      {ctl.engine === "elevenlabs" && (
        <span className="text-[12px] text-muted-foreground">
          Los subtítulos salen con los tiempos exactos de ElevenLabs, sin Whisper.
        </span>
      )}
    </div>
  );

  // Ajustes de Piper: voz, velocidad y pausa entre segmentos.
  const controls = ctl.engine === "elevenlabs" && ctl.eleven ? (
    <div className="grid gap-3">
      <ElevenLabsPanel
        configured={state.elevenlabs_configured}
        prefs={ctl.eleven}
        onChange={ctl.setEleven}
        characters={ctl.characters}
        disabled={ctl.running}
      />
      <label className="grid max-w-60 gap-1.5 text-[12px] text-muted-foreground">
        Pausa entre segmentos
        <Select value={String(ctl.pause)} onValueChange={(v) => ctl.setPause(Number(v))} disabled={ctl.running}>
          <SelectTrigger className="w-full" aria-label="Pausa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAUSES.map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p === 0 ? "Sin pausa" : `${p} s`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  ) : (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <label className="grid gap-1.5 text-[12px] text-muted-foreground">
        Voz de Piper
        <VoiceSelect value={ctl.voiceId} onChange={ctl.setVoiceId} disabled={ctl.running} />
      </label>
      <label className="grid gap-1.5 text-[12px] text-muted-foreground">
        Velocidad
        <Select value={String(ctl.speed)} onValueChange={(v) => ctl.setSpeed(Number(v))} disabled={ctl.running}>
          <SelectTrigger className="w-full" aria-label="Velocidad">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {speedLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5 text-[12px] text-muted-foreground">
        Pausa entre segmentos
        <Select value={String(ctl.pause)} onValueChange={(v) => ctl.setPause(Number(v))} disabled={ctl.running}>
          <SelectTrigger className="w-full" aria-label="Pausa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAUSES.map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p === 0 ? "Sin pausa" : `${p} s`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );

  if (ctl.running) {
    return (
      <>
        {header}
        <JobProgress
          job={ctl.job}
          fallback="Preparando la voz…"
          hint={
            ctl.engine === "elevenlabs"
              ? "ElevenLabs genera cada segmento en la nube; los subtítulos salen con sus tiempos exactos."
              : "Todo se hace en tu equipo. La primera vez se descarga el modelo de voz o de Whisper."
          }
        />
      </>
    );
  }

  const audioUrl = state.audio_url ? `${coreUrl(state.audio_url)}?v=${ctl.version}` : null;
  const play = (time: number) => setSeek({ time, play: true, nonce: Date.now() });

  return (
    <>
      {header}
      {ctl.error && <ErrorBanner message={ctl.error} onClose={ctl.dismissError} />}
      {state.stale && (
        <NoticeBanner>
          El guion cambió después de la voz: las escenas volvieron a los tiempos estimados.{" "}
          {state.source === "recorded" ? "Graba de nuevo o transcribe otra vez." : "Genera la voz otra vez."}
        </NoticeBanner>
      )}
      {state.source === "recorded" && !state.timing_source && !state.stale && (
        <NoticeBanner>
          Transcribe la voz con Whisper (modelo «{state.whisper_model}») para obtener los tiempos reales.
        </NoticeBanner>
      )}

      <div className="grid gap-4 p-5">
        {engineToggle}
        {controls}
        {audioUrl ? (
          <Waveform
            url={audioUrl}
            segments={state.segments}
            seek={seek}
            onTime={(t) => setCurrent(segmentAt(state.segments, t))}
          />
        ) : (
          <EmptyState
            icon={Mic}
            title="Todavía no hay voz"
            description="Genérala con Piper (gratis y sin conexión) o ElevenLabs (profesional, con subtítulos exactos), o sube tu propia grabación: Whisper la transcribe y alinea con el guion."
          />
        )}

        <div className="divide-y rounded-md border">
          {state.segments.map((s, i) => (
            <div
              key={s.seg_key}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 text-[13px]",
                current === s.seg_key && "bg-panel-2",
              )}
            >
              <span className="w-8 shrink-0 pt-0.5 font-mono text-[11px] text-subtle">{i + 1}</span>
              <span className="w-32 shrink-0 pt-0.5 font-mono text-[12px] text-muted-foreground">
                {s.start_s != null ? `${formatSceneTime(s.start_s)} – ${formatSceneTime(s.end_s)}` : "—"}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">{s.text}</span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Escuchar el segmento ${i + 1}`}
                  disabled={!audioUrl || s.start_s == null}
                  onClick={() => s.start_s != null && play(s.start_s)}
                >
                  <Play />
                </Button>
                {(state.source === "piper" || state.source === "elevenlabs") && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Regenerar el segmento ${i + 1}`}
                    title="Regenerar solo este segmento"
                    onClick={() => ctl.regenerate(s.seg_key)}
                  >
                    <RefreshCw />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
