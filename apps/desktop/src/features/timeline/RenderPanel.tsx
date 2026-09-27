import { Clapperboard, FolderOpen, LoaderCircle, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatSize } from "@/features/storage/treemap";
import { useRevealProject } from "@/hooks/useManualMedia";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useCancelJob, useRenderState, useStartRender } from "@/hooks/useRender";
import { coreUrl, type Project, type RenderQuality } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { exportedAt } from "./timelineMeta";

export const QUALITIES: { id: RenderQuality; label: string; detail: string; hint: string }[] = [
  { id: "draft", label: "Borrador", detail: "720p · rápido", hint: "Para revisar el montaje en poco tiempo" },
  { id: "standard", label: "Estándar", detail: "1080p", hint: "Buen equilibrio entre calidad y tiempo" },
  { id: "high", label: "Alta", detail: "1080p nítido", hint: "Menos compresión y audio a 256 kbps; tarda más" },
  { id: "max", label: "4K", detail: "reescalado 2160p", hint: "YouTube le da más bitrate: se ve mejor incluso en 1080p. Es el más lento" },
];

export const qualityLabel = (q: RenderQuality | null | undefined) => QUALITIES.find((x) => x.id === q)?.label ?? null;

/** Render automático con FFmpeg (sección 16): calidad a elegir, cancelable, con miniatura. */
export function RenderPanel({ project }: { project: Project }) {
  const { data: state, dataUpdatedAt } = useRenderState(project.id);
  const start = useStartRender(project.id);
  const cancel = useCancelJob();
  const reveal = useRevealProject();
  const [burn, setBurn] = useState<boolean | null>(null);
  const quality = useUiStore((s) => s.renderQuality);
  const setQuality = useUiStore((s) => s.setRenderQuality);
  const chosen = useRef<RenderQuality>(quality);
  const job = useProjectJob(
    project.id,
    "render",
    () => start.mutateAsync({ quality: chosen.current, burn_subtitles: burnSubtitles }),
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

  if (!state) return null;
  const burnSubtitles = state.has_subtitles ? (burn ?? state.default_burn_subtitles) : false;
  const final = state.files.find((f) => f.kind === "final");
  const preview = final ?? state.files.find((f) => f.kind === "draft");
  const thumb = state.files.find((f) => f.kind === "thumbnail");
  const run = () => {
    chosen.current = quality;
    void job.start();
  };
  const cancelling = cancel.isPending || job.job?.message === "Cancelando…";

  return (
    <section className="grid gap-3 rounded-md border p-4" aria-label="Render">
      <div className="flex flex-wrap items-center gap-3">
        <Clapperboard className="size-4 text-brand" />
        <h3 className="text-[13px] font-medium">Render automático</h3>
        <span className="text-[12px] text-muted-foreground">
          {state.scenes} escenas · {formatDuration(state.duration_s)} · efectos, voz, SFX y música con ducking
        </span>
        <label
          className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground"
          title={state.has_subtitles ? undefined : "Genera o transcribe la voz para tener subtítulos"}
        >
          <input
            type="checkbox"
            checked={burnSubtitles}
            disabled={!state.has_subtitles || job.running}
            onChange={(e) => setBurn(e.target.checked)}
          />
          Quemar subtítulos
        </label>
      </div>

      {/* Calidad */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div role="radiogroup" aria-label="Calidad del render" className="grid flex-1 grid-cols-4 gap-2">
          {QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={quality === q.id}
              disabled={job.running}
              title={q.hint}
              onClick={() => setQuality(q.id)}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-60",
                quality === q.id ? "border-brand bg-active" : "hover:bg-panel-2",
              )}
            >
              <span className={cn("block text-[13px] font-medium", quality === q.id && "text-active-foreground")}>
                {q.label}
              </span>
              <span className="block text-[11px] text-muted-foreground">{q.detail}</span>
            </button>
          ))}
        </div>
        {job.running ? (
          <Button
            variant="outline"
            className="h-auto self-stretch border-danger/60 px-5 text-danger hover:bg-danger/10"
            disabled={cancelling || !job.job}
            onClick={() => job.job && cancel.mutate(job.job.id)}
          >
            {cancelling ? <LoaderCircle className="animate-spin" /> : <Square className="fill-current" />}
            {cancelling ? "Cancelando…" : "Cancelar render"}
          </Button>
        ) : (
          <Button className="h-auto self-stretch px-5" disabled={!state.can_render} onClick={run}>
            <Clapperboard /> Renderizar
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">{QUALITIES.find((q) => q.id === quality)?.hint}</p>

      {state.reason && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}
      {!state.has_voice && state.can_render && (
        <p className="flex items-center gap-1.5 text-[12px] text-warning">
          <TriangleAlert className="size-3.5" /> Sin voz: el video sale solo con música y efectos.
        </p>
      )}
      {job.running && (
        <div className="grid gap-1.5">
          <Progress value={(job.job?.progress ?? 0) * 100} aria-label="Progreso del render" />
          <span className="text-[12px] text-muted-foreground">
            {qualityLabel(chosen.current)} · {job.job?.message ?? "Preparando…"}
          </span>
        </div>
      )}
      {job.error && <p className="text-[12px] text-danger">{job.error}</p>}
      {preview && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <video
            key={`${preview.name}-${dataUpdatedAt}`}
            src={`${coreUrl(preview.url)}?v=${encodeURIComponent(preview.updated_at)}`}
            controls
            className="max-h-[420px] w-full rounded bg-black"
          />
          <div className="grid content-start gap-2 text-[12px]">
            {state.files
              .filter((f) => f.kind !== "thumbnail")
              .map((f) => (
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
                className="rounded border"
              />
            )}
            <Button size="sm" variant="ghost" onClick={() => reveal.mutate(project.id)}>
              <FolderOpen /> Abrir carpeta
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
