import { ChevronDown, Clapperboard, FolderOpen, LoaderCircle, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { formatSize } from "@/features/storage/treemap";
import { useRevealProject } from "@/hooks/useManualMedia";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useCancelJob, useRenderState, useStartRender } from "@/hooks/useRender";
import { coreUrl, type Project, type RenderQuality, type RenderState, type SubtitleStyle } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { SubtitleStylePanel } from "./SubtitleStylePanel";
import { exportedAt } from "./timelineMeta";

export const QUALITIES: { id: RenderQuality; label: string; detail: string; hint: string }[] = [
  { id: "draft", label: "Borrador", detail: "720p · rápido", hint: "Para revisar el montaje en poco tiempo" },
  { id: "standard", label: "Estándar", detail: "1080p", hint: "Buen equilibrio entre calidad y tiempo" },
  { id: "high", label: "Alta", detail: "1080p nítido", hint: "Menos compresión y audio a 256 kbps; tarda más" },
  { id: "max", label: "4K", detail: "reescalado 2160p", hint: "YouTube le da más bitrate: se ve mejor incluso en 1080p. Es el más lento" },
];

export const qualityLabel = (q: RenderQuality | null | undefined) => QUALITIES.find((x) => x.id === q)?.label ?? null;

export const DEFAULT_STYLE: SubtitleStyle = {
  uppercase: true,
  words_per_line: 0,
  font: "Arial",
  size: "medium",
  position: "bottom",
  text_color: "#FFFFFF",
  outline_color: "#000000",
  highlight: true,
  highlight_color: "#FFD400",
  background: false,
};

/** Estado compartido del render: calidad, subtítulos (y su estilo) y el trabajo en curso. */
export function useRenderController(project: Project) {
  const { data: state, dataUpdatedAt } = useRenderState(project.id);
  const start = useStartRender(project.id);
  const cancel = useCancelJob();
  const [burn, setBurn] = useState<boolean | null>(null);
  const [stylePatch, setStylePatch] = useState<Partial<SubtitleStyle>>({});
  const quality = useUiStore((s) => s.renderQuality);
  const setQuality = useUiStore((s) => s.setRenderQuality);
  const chosen = useRef<RenderQuality>(quality);

  const burnSubtitles = state?.has_subtitles ? (burn ?? state.default_burn_subtitles) : false;
  const style: SubtitleStyle = { ...DEFAULT_STYLE, ...state?.subtitle_style, ...stylePatch };

  const job = useProjectJob(
    project.id,
    "render",
    () =>
      start.mutateAsync({
        quality: chosen.current,
        burn_subtitles: burnSubtitles,
        subtitle_style: burnSubtitles ? style : null,
      }),
    (done) => toast.success(`Render listo: ${String(done.result?.file ?? "")}`),
  );

  // Aviso al cancelar (el render anterior queda intacto).
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = job.job?.status;
    if (status === "cancelled" && lastStatus.current !== "cancelled") {
      toast("Render cancelado", { description: "El render anterior, si había, se conserva." });
    }
    lastStatus.current = status;
  }, [job.job?.status]);

  return {
    state,
    version: dataUpdatedAt,
    quality,
    setQuality,
    burnSubtitles,
    setBurn,
    style,
    setStyle: (patch: Partial<SubtitleStyle>) => setStylePatch((p) => ({ ...p, ...patch })),
    job,
    chosenQuality: chosen.current,
    run: () => {
      chosen.current = quality;
      void job.start();
    },
    cancel: () => job.job && cancel.mutate(job.job.id),
    cancelling: cancel.isPending || job.job?.message === "Cancelando…",
  };
}

export type RenderController = ReturnType<typeof useRenderController>;

/** Sección plegable del panel lateral. */
export function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-panel-2/60"
      >
        <span className="text-[13px] font-medium">{title}</span>
        {summary && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground">{summary}</span>}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** Calidad + Renderizar / Cancelar + progreso (siempre visible arriba del panel). */
export function RenderControls({ ctl }: { ctl: RenderController }) {
  const { state, job } = ctl;
  if (!state) return null;
  return (
    <div className="grid gap-3 border-b p-4" aria-label="Render" role="region">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-4 text-brand" />
        <h3 className="text-[13px] font-medium">Render</h3>
      </div>
      <div role="radiogroup" aria-label="Calidad del render" className="grid grid-cols-2 gap-1.5">
        {QUALITIES.map((q) => (
          <button
            key={q.id}
            type="button"
            role="radio"
            aria-checked={ctl.quality === q.id}
            disabled={job.running}
            title={q.hint}
            onClick={() => ctl.setQuality(q.id)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-60",
              ctl.quality === q.id ? "border-brand bg-active" : "hover:bg-panel-2",
            )}
          >
            <span className={cn("block text-[12px] font-medium", ctl.quality === q.id && "text-active-foreground")}>{q.label}</span>
            <span className="block text-[11px] text-muted-foreground">{q.detail}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{QUALITIES.find((q) => q.id === ctl.quality)?.hint}</p>
      {job.running ? (
        <Button
          variant="outline"
          className="border-danger/60 text-danger hover:bg-danger/10"
          disabled={ctl.cancelling || !job.job}
          onClick={ctl.cancel}
        >
          {ctl.cancelling ? <LoaderCircle className="animate-spin" /> : <Square className="fill-current" />}
          {ctl.cancelling ? "Cancelando…" : "Cancelar render"}
        </Button>
      ) : (
        <Button disabled={!state.can_render} onClick={ctl.run}>
          <Clapperboard /> Renderizar
        </Button>
      )}
      {job.running && (
        <div className="grid gap-1.5">
          <Progress value={(job.job?.progress ?? 0) * 100} aria-label="Progreso del render" />
          <span className="text-[12px] text-muted-foreground">
            {qualityLabel(ctl.chosenQuality)} · {job.job?.message ?? "Preparando…"}
          </span>
        </div>
      )}
      {state.reason && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}
      {!state.has_voice && state.can_render && (
        <p className="flex items-center gap-1.5 text-[12px] text-warning">
          <TriangleAlert className="size-3.5" /> Sin voz: el video sale solo con música y efectos.
        </p>
      )}
      {job.error && <p className="text-[12px] text-danger">{job.error}</p>}
    </div>
  );
}

/** Subtítulos: quemarlos o no, y su estilo (se ve al instante en la vista previa). */
export function SubtitlesSettings({ ctl, portrait }: { ctl: RenderController; portrait: boolean }) {
  const { state } = ctl;
  if (!state) return null;
  return (
    <div className="grid gap-3">
      <label
        className="flex items-center justify-between gap-2 text-[12px]"
        title={state.has_subtitles ? undefined : "Genera o transcribe la voz para tener subtítulos"}
      >
        <span>Quemar subtítulos en el video</span>
        <Switch
          aria-label="Quemar subtítulos"
          checked={ctl.burnSubtitles}
          disabled={!state.has_subtitles || ctl.job.running}
          onCheckedChange={(v) => ctl.setBurn(v)}
        />
      </label>
      {!state.has_subtitles && (
        <p className="text-[12px] text-muted-foreground">Genera la voz para tener subtítulos.</p>
      )}
      {ctl.burnSubtitles && (
        <SubtitleStylePanel style={ctl.style} onChange={ctl.setStyle} portrait={portrait} disabled={ctl.job.running} compact />
      )}
    </div>
  );
}

/** Archivos del último render, con la miniatura y la carpeta. */
export function RenderFiles({ project, state }: { project: Project; state: RenderState }) {
  const reveal = useRevealProject();
  const thumb = state.files.find((f) => f.kind === "thumbnail");
  const videos = state.files.filter((f) => f.kind !== "thumbnail");
  if (!videos.length) return <p className="text-[12px] text-muted-foreground">Todavía no hay renders.</p>;
  return (
    <div className="grid gap-2 text-[12px]">
      {videos.map((f) => (
        <div key={f.name} className="rounded-md border p-2">
          <div className="font-medium">
            {f.kind === "final" ? "Final" : "Borrador"}
            {f.kind === "final" && qualityLabel(f.quality) && ` · ${qualityLabel(f.quality)}`} · {f.width}×{f.height}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            render/{f.name} · {formatSize(f.size_bytes)} · {exportedAt(f.updated_at)}
          </div>
        </div>
      ))}
      {thumb && (
        <img
          src={`${coreUrl(thumb.url)}?v=${encodeURIComponent(thumb.updated_at)}`}
          alt="Miniatura sugerida"
          className="max-h-40 w-fit rounded border"
        />
      )}
      <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => reveal.mutate(project.id)}>
        <FolderOpen /> Abrir carpeta
      </Button>
    </div>
  );
}

/** El MP4 ya renderizado (pestaña «Render» del reproductor). */
export function RenderedVideo({ state, version }: { state: RenderState; version: number }) {
  const final = state.files.find((f) => f.kind === "final");
  const video = final ?? state.files.find((f) => f.kind === "draft");
  if (!video) {
    return <p className="text-[13px] text-muted-foreground">Todavía no hay render: pulsa «Renderizar».</p>;
  }
  return (
    <video
      key={`${video.name}-${version}`}
      src={`${coreUrl(video.url)}?v=${encodeURIComponent(video.updated_at)}`}
      controls
      data-testid="rendered-video"
      className="h-full max-w-full rounded bg-black"
    />
  );
}
