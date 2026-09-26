import { Clapperboard, FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatSize } from "@/features/storage/treemap";
import { useRevealProject } from "@/hooks/useManualMedia";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useRenderState, useStartRender } from "@/hooks/useRender";
import { coreUrl, type Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { exportedAt } from "./timelineMeta";

/** Render automático con FFmpeg (sección 16): borrador 720p o final, con miniatura. */
export function RenderPanel({ project }: { project: Project }) {
  const { data: state, dataUpdatedAt } = useRenderState(project.id);
  const start = useStartRender(project.id);
  const reveal = useRevealProject();
  const [burn, setBurn] = useState<boolean | null>(null);
  const draft = useRef(false);
  const job = useProjectJob(
    project.id,
    "render",
    () => start.mutateAsync({ draft: draft.current, burn_subtitles: burnSubtitles }),
    (done) => toast.success(`Render listo: ${String(done.result?.file ?? "")}`),
  );
  if (!state) return null;
  const burnSubtitles = state.has_subtitles ? (burn ?? state.default_burn_subtitles) : false;
  const final = state.files.find((f) => f.kind === "final");
  const preview = final ?? state.files.find((f) => f.kind === "draft");
  const thumb = state.files.find((f) => f.kind === "thumbnail");
  const run = (isDraft: boolean) => {
    draft.current = isDraft;
    void job.start();
  };

  return (
    <section className="grid gap-3 rounded-md border p-4" aria-label="Render">
      <div className="flex flex-wrap items-center gap-3">
        <Clapperboard className="size-4 text-brand" />
        <h3 className="text-[13px] font-medium">Render automático</h3>
        <span className="text-[12px] text-muted-foreground">
          {state.scenes} escenas · {formatDuration(state.duration_s)} · efectos, voz, SFX y música con ducking
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground" title={state.has_subtitles ? undefined : "Genera o transcribe la voz para tener subtítulos"}>
          <input type="checkbox" checked={burnSubtitles} disabled={!state.has_subtitles || job.running} onChange={(e) => setBurn(e.target.checked)} />
          Quemar subtítulos
        </label>
        <Button size="sm" variant="outline" disabled={!state.can_render || job.running} onClick={() => run(true)}>
          Borrador 720p
        </Button>
        <Button size="sm" disabled={!state.can_render || job.running} onClick={() => run(false)}>
          {job.running ? <LoaderCircle className="animate-spin" /> : <Clapperboard />} Render final
        </Button>
      </div>
      {state.reason && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}
      {!state.has_voice && state.can_render && (
        <p className="flex items-center gap-1.5 text-[12px] text-warning">
          <TriangleAlert className="size-3.5" /> Sin voz: el video sale solo con música y efectos.
        </p>
      )}
      {job.running && (
        <div className="grid gap-1.5">
          <Progress value={(job.job?.progress ?? 0) * 100} aria-label="Progreso del render" />
          <span className="text-[12px] text-muted-foreground">{job.job?.message ?? "Preparando…"}</span>
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
                  <div className="font-medium">{f.kind === "final" ? "Final" : "Borrador"} · {f.width}×{f.height}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    render/{f.name} · {formatSize(f.size_bytes)} · {exportedAt(f.updated_at)}
                  </div>
                </div>
              ))}
            {thumb && (
              <img src={`${coreUrl(thumb.url)}?v=${encodeURIComponent(thumb.updated_at)}`} alt="Miniatura sugerida" className="rounded border" />
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
