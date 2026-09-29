import { useQueryClient } from "@tanstack/react-query";
import { FileVideo, LoaderCircle, RefreshCw, Replace } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startTranscription, useReplaceVideo, useTranscript } from "@/hooks/useImported";
import { useProjectJob } from "@/hooks/useProjectJob";
import { useRenderState } from "@/hooks/useRender";
import { coreUrl, type Project } from "@/lib/api";

/**
 * Proyecto importado (video terminado en otro editor): el video, la transcripción que usa
 * Claude para los textos y reemplazar por otra exportación.
 */
export function ImportedVideoPanel({ project }: { project: Project }) {
  const client = useQueryClient();
  const { data: render } = useRenderState(project.id);
  const { data: transcript } = useTranscript(project.id);
  const replace = useReplaceVideo(project.id);
  const picker = useRef<HTMLInputElement>(null);
  const job = useProjectJob(project.id, "transcribe_video", () => startTranscription(project.id), () => {
    toast.success("Transcripción lista: Claude la usa para los textos");
    void client.invalidateQueries({ queryKey: ["transcript", project.id] });
  });
  const video = render?.files.find((f) => f.kind === "final");

  return (
    <section className="grid gap-3 rounded-md border p-4" aria-label="Video importado">
      <div className="flex flex-wrap items-center gap-2">
        <FileVideo className="size-4 text-brand" />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium">Video terminado (importado)</h3>
        <Button size="sm" variant="outline" disabled={replace.isPending} onClick={() => picker.current?.click()}>
          {replace.isPending ? <LoaderCircle className="animate-spin" /> : <Replace />} Reemplazar video
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".mp4,.mov,.m4v,.mkv,.webm,video/*"
          hidden
          aria-label="Nueva versión del video"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            replace.mutate(
              { file, transcribe: true },
              {
                onSuccess: () => toast.success("Video reemplazado; se vuelve a transcribir"),
                onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo reemplazar"),
              },
            );
          }}
        />
      </div>
      {video ? (
        <div className="flex flex-wrap items-start gap-4">
          <video
            key={video.updated_at}
            src={`${coreUrl(video.url)}?v=${encodeURIComponent(video.updated_at)}`}
            controls
            preload="metadata"
            className="max-h-72 rounded bg-black"
          />
          <div className="grid gap-0.5 text-[12px] text-muted-foreground">
            <span className="font-mono">render/{video.name}</span>
            <span>
              {video.width}×{video.height} · {Math.round(video.duration_s ?? 0)} s
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">No se encuentra el video en la carpeta render/.</p>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <h4 className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground">Lo que se dice en el video (Whisper)</h4>
          <Button size="sm" variant="ghost" disabled={job.running} onClick={() => void job.start()}>
            {job.running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {job.running ? (job.job?.message ?? "Transcribiendo…") : transcript?.text ? "Transcribir de nuevo" : "Transcribir el audio"}
          </Button>
        </div>
        {job.error && <p className="text-[12px] text-danger">{job.error}</p>}
        {transcript?.text ? (
          <p className="max-h-40 overflow-y-auto rounded bg-panel-2 p-2 text-[12px] leading-relaxed" data-testid="transcript">
            {transcript.text}
          </p>
        ) : (
          !job.running && (
            <p className="text-[12px] text-subtle">
              Sin transcripción: Claude escribirá los textos solo con el título y «¿De qué trata?».
            </p>
          )
        )}
      </div>
    </section>
  );
}
