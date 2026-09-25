import { AudioLines, FileCheck2, Film, FolderOpen, Type } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { NoticeBanner } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { KINDS } from "@/features/scenes/sceneMeta";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import { useRevealProject } from "@/hooks/useManualMedia";
import { useTimeline } from "@/hooks/useTimeline";
import { coreUrl, type Project, type TimelineScene } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { cn } from "@/lib/utils";
import {
  exportedAt,
  FORMAT_FILES,
  MARKER_TONE,
  pct,
  resolutionLabel,
  rulerTicks,
} from "./timelineMeta";

const TONE = Object.fromEntries(KINDS.map((k) => [k.id, k.tone]));

export function TimelineStage({ project, onGoToMedia }: { project: Project; onGoToMedia: () => void }) {
  const { data: state } = useTimeline(project.id);
  const reveal = useRevealProject();
  if (!state) return null;
  if (!state.scenes.length) {
    return <EmptyState icon={Film} title="Todavía no hay escenas" description="El timeline se arma con las escenas aprobadas." />;
  }

  const d = state.duration_s;
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <span className="text-[13px] font-medium">Timeline</span>
        <span className="text-[12px] text-muted-foreground">{resolutionLabel(state)}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => reveal.mutate(project.id)}>
          <FolderOpen /> Abrir carpeta
        </Button>
      </div>
      {state.reason && (
        <NoticeBanner
          action={
            <Button size="xs" variant="outline" onClick={onGoToMedia}>
              Ir a medios
            </Button>
          }
        >
          {state.reason}
        </NoticeBanner>
      )}
      {state.warnings.length > 0 && (
        <NoticeBanner>
          <ul className="grid gap-0.5">
            {state.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </NoticeBanner>
      )}

      <div className="grid gap-5 p-5">
        {/* Pistas (vista previa de lo que se exporta) */}
        <div className="overflow-hidden rounded-md border bg-panel">
          <div className="grid grid-cols-[88px_minmax(0,1fr)]">
            <div />
            <div className="relative h-6 border-b">
              {rulerTicks(d).map((t) => (
                <span
                  key={t}
                  className="absolute top-1 -translate-x-1/2 font-mono text-[10px] text-subtle first:translate-x-0"
                  style={{ left: `${pct(t, d)}%` }}
                >
                  {formatDuration(t)}
                </span>
              ))}
            </div>

            <TrackLabel icon={Film} label="Video" />
            <div className="relative h-16 border-b" data-testid="track-video">
              {state.scenes.map((s) => (
                <SceneBlock key={s.position} scene={s} duration={d} />
              ))}
            </div>

            <TrackLabel icon={Type} label="Marcadores" />
            <div className="relative h-8 border-b">
              {state.markers.map((m) => (
                <span
                  key={`${m.time_s}-${m.name}`}
                  title={m.note ? `${m.name}\n${m.note}` : m.name}
                  className={cn("absolute top-2 size-3 -translate-x-1/2 rotate-45 rounded-[2px]", MARKER_TONE[m.color])}
                  style={{ left: `calc(${pct(m.time_s, d)}% + 6px)` }}
                />
              ))}
            </div>

            <TrackLabel icon={AudioLines} label="Voz" />
            <div className="relative h-10">
              {state.has_voice ? (
                <div
                  className="absolute inset-y-2 left-0 flex items-center rounded-sm bg-success-foreground/20 px-2 text-[11px] text-success-foreground"
                  style={{ width: `${pct(state.voice_duration_s ?? 0, d)}%` }}
                >
                  voz · {formatDuration(state.voice_duration_s)}
                </div>
              ) : (
                <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-subtle">
                  Sin voz: se usan los tiempos estimados
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Marcadores: lo que el editor debe armar a mano */}
        <div className="divide-y rounded-md border">
          {state.markers.map((m) => (
            <div key={`${m.time_s}-${m.name}`} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className={cn("size-2.5 shrink-0 rotate-45 rounded-[2px]", MARKER_TONE[m.color])} />
              <span className="w-16 shrink-0 font-mono text-[12px] text-muted-foreground">
                {formatSceneTime(m.time_s)}
              </span>
              <span className="w-40 shrink-0 font-medium">{m.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.note || "—"}</span>
            </div>
          ))}
        </div>

        {/* Archivos exportados */}
        <div className="grid grid-cols-3 gap-3">
          {FORMAT_FILES.map((f) => {
            const done = state.exports.find((e) => e.format === f.format);
            return (
              <div key={f.format} className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <FileCheck2 className={cn("size-4", done ? "text-success-foreground" : "text-subtle")} />
                  {f.label}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {done ? `timeline/${done.file} · ${exportedAt(done.updated_at)}` : "Sin exportar"}
                </div>
                <div className="mt-1 text-[12px] text-subtle">{f.hint}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TrackLabel({ icon: Icon, label }: { icon: typeof Film; label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-r border-b px-2 text-[11px] text-muted-foreground last-of-type:border-b-0">
      <Icon className="size-3.5" /> {label}
    </div>
  );
}

function SceneBlock({ scene, duration }: { scene: TimelineScene; duration: number }) {
  const clipPart = scene.clip_duration_s != null ? scene.clip_duration_s / scene.duration_s : 0;
  const thumb = coreUrl(scene.thumb_url);
  return (
    <div
      className="absolute inset-y-1.5 px-px"
      style={{ left: `${pct(scene.start_s, duration)}%`, width: `${pct(scene.duration_s, duration)}%` }}
      title={`Escena ${scene.position} · ${formatSceneTime(scene.start_s)} · ${scene.file_name ?? scene.text ?? "sin medio"}`}
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-sm",
          scene.file_name ? TONE[scene.kind] : "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.04)_6px_12px)]",
        )}
      >
        {thumb && (
          <div
            className="absolute inset-y-0 left-0 bg-cover bg-center opacity-70"
            style={{ backgroundImage: `url("${thumb}")`, width: `${clipPart * 100}%` }}
          />
        )}
        <span className="relative m-1 inline-block rounded bg-black/55 px-1 font-mono text-[10px] text-white">
          {scene.position}
        </span>
        {!scene.file_name && scene.text && (
          <span className="relative block truncate px-1 text-[11px] italic text-[#e8c374]">«{scene.text}»</span>
        )}
      </div>
    </div>
  );
}
