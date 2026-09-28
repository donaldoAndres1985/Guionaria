import {
  AudioLines,
  Captions,
  FileCheck2,
  Film,
  FolderOpen,
  Music,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Type,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { NoticeBanner } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { TrimDialog, type TrimTarget } from "@/features/media/TrimDialog";
import { formatSceneTime, KINDS } from "@/features/scenes/sceneMeta";
import { useRevealProject } from "@/hooks/useManualMedia";
import { usePreview, useTimeline } from "@/hooks/useTimeline";
import { coreUrl, type Project, type TimelineScene, type TimelineSound } from "@/lib/api";
import { formatDuration, STATUS_ORDER } from "@/lib/project";
import { cn } from "@/lib/utils";
import { PreviewCanvas, usePreviewClock } from "./PreviewPlayer";
import { captionGroups, captionLayout, formatClock, sceneIndexAt } from "./previewMeta";
import {
  RenderControls,
  RenderedVideo,
  RenderFiles,
  Section,
  SubtitlesSettings,
  useRenderController,
} from "./RenderPanel";
import { TextStylePanel, textStyleSummary } from "./TextStylePanel";
import { CutMarkers, TransitionsPanel, transitionsSummary } from "./TransitionsPanel";
import { LookPanel, lookSummary } from "./LookPanel";
import { useTransitions } from "@/hooks/useTransitions";
import { exportedAt, FORMAT_FILES, MARKER_TONE, pct, resolutionLabel, rulerTicks } from "./timelineMeta";

const TONE = Object.fromEntries(KINDS.map((k) => [k.id, k.tone]));

type SectionId = "look" | "subtitles" | "text" | "transitions" | "files" | "markers" | "exports";

export function TimelineStage({ project, onGoToMedia }: { project: Project; onGoToMedia: () => void }) {
  const { data: state } = useTimeline(project.id);
  const { data: preview } = usePreview(project.id);
  const render = useRenderController(project);
  const { data: transitions } = useTransitions(project.id);
  const reveal = useRevealProject();
  const [trim, setTrim] = useState<TrimTarget | null>(null);
  const [tab, setTab] = useState<"preview" | "render">("preview");
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    look: false,
    subtitles: false,
    text: false,
    transitions: false,
    files: false,
    markers: false,
    exports: false,
  });
  const duration = preview?.duration_s ?? state?.duration_s ?? 0;
  const clock = usePreviewClock(duration);
  const portrait = (preview?.height ?? state?.height ?? 0) > (preview?.width ?? state?.width ?? 1);

  // Atajos: Espacio reproduce/pausa, ← → escena anterior/siguiente, Inicio vuelve al principio.
  const keys = useRef({ clock, preview, tab, trim });
  keys.current = { clock, preview, tab, trim };
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      e.target instanceof Element &&
      !!e.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']");
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const { clock: c, preview: p, tab: t, trim: tr } = keys.current;
      if (t !== "preview" || tr || !p) return;
      const i = sceneIndexAt(p.scenes, c.time);
      if (e.key === " ") c.toggle();
      else if (e.key === "ArrowRight") c.seek(p.scenes[Math.min(i + 1, p.scenes.length - 1)]?.start_s ?? 0);
      else if (e.key === "ArrowLeft") {
        const here = p.scenes[i];
        // Si ya avanzó dentro de la escena, vuelve a su inicio; si no, a la anterior.
        c.seek(here && c.time - here.start_s > 0.5 ? here.start_s : (p.scenes[Math.max(i - 1, 0)]?.start_s ?? 0));
      } else if (e.key === "Home") c.seek(0);
      else return;
      // Evita que Espacio pulse el botón con foco (p. ej. «Renderizar»).
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && !typing(e) && keys.current.tab === "preview" && !keys.current.trim) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  const groups = useMemo(() => {
    if (!preview) return [];
    const layout = captionLayout(render.style, portrait);
    return captionGroups(preview.words, layout.perLine, layout.maxChars);
  }, [preview, render.style, portrait]);

  if (!state) return null;
  if (!state.scenes.length) {
    return <EmptyState icon={Film} title="Todavía no hay escenas" description="El timeline se arma con las escenas aprobadas." />;
  }

  const d = state.duration_s;
  const canTrim = STATUS_ORDER.indexOf(project.status) < STATUS_ORDER.indexOf("PROGRAMADO");
  const openTrim = (s: TimelineScene) =>
    s.scene_id != null &&
    s.asset_id != null &&
    setTrim({ sceneId: s.scene_id, assetId: s.asset_id, fileUrl: `/api/assets/${s.asset_id}/file`, position: s.position });
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const editSubtitles = () => setOpen((o) => ({ ...o, subtitles: true }));
  const sceneIndex = preview ? sceneIndexAt(preview.scenes, clock.time) : -1;
  const seekTo = (t: number) => {
    setTab("preview");
    clock.seek(t);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <span className="text-[13px] font-medium">Timeline</span>
        <span className="text-[12px] text-muted-foreground">{resolutionLabel(state)}</span>
        <Button size="sm" className="ml-auto" onClick={() => reveal.mutate(project.id)}>
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
      {state.warnings.length > 0 && <TimelineWarnings warnings={state.warnings} />}

      <div className="flex min-h-0 flex-1">
        {/* Reproductor: vista previa en vivo o el MP4 renderizado */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div role="tablist" aria-label="Reproductor" className="flex w-fit rounded-md border p-0.5 text-[12px]">
            {(
              [
                ["preview", "Vista previa"],
                ["render", "Render"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  clock.pause();
                  setTab(id);
                }}
                className={cn(
                  "rounded px-3 py-1",
                  tab === id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {tab === "preview" ? (
              preview ? (
                <PreviewCanvas
                  preview={preview}
                  time={clock.time}
                  playing={clock.playing}
                  burnSubtitles={render.burnSubtitles}
                  style={render.style}
                  textStyle={render.textStyle}
                  look={render.look}
                  onSubtitlesClick={editSubtitles}
                />
              ) : null
            ) : render.state ? (
              <RenderedVideo state={render.state} version={render.version} />
            ) : null}
          </div>
          {tab === "preview" && preview && (
            <div className="flex items-center gap-2 text-[12px]">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Escena anterior"
                onClick={() => clock.seek(preview.scenes[Math.max(sceneIndex - 1, 0)]?.start_s ?? 0)}
              >
                <SkipBack />
              </Button>
              <Button size="icon" aria-label={clock.playing ? "Pausar" : "Reproducir"} onClick={clock.toggle}>
                {clock.playing ? <Pause /> : <Play />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Escena siguiente"
                onClick={() => clock.seek(preview.scenes[Math.min(sceneIndex + 1, preview.scenes.length - 1)]?.start_s ?? 0)}
              >
                <SkipForward />
              </Button>
              <span className="font-mono whitespace-nowrap" data-testid="preview-clock">
                {formatClock(clock.time)} / {formatClock(duration)}
              </span>
              <span className="whitespace-nowrap text-muted-foreground">
                · Escena {sceneIndex + 1} de {preview.scenes.length}
              </span>
              <span className="ml-auto hidden truncate text-subtle xl:block" title="La vista previa es aproximada; el render es el resultado final">
                Espacio: reproducir · ← → escena
              </span>
            </div>
          )}
        </div>

        {/* Panel lateral */}
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l" aria-label="Opciones del render">
          <RenderControls ctl={render} />
          <Section title="Look del video" summary={lookSummary(render.look)} open={open.look} onToggle={() => toggle("look")}>
            <LookPanel
              look={render.look}
              onChange={render.setLook}
              luts={render.state?.luts ?? []}
              projectId={project.id}
              disabled={render.job.running}
            />
          </Section>
          <Section
            title="Subtítulos"
            summary={render.burnSubtitles ? (render.style.highlight ? "Quemados · palabra resaltada" : "Quemados") : "No se queman"}
            open={open.subtitles}
            onToggle={() => toggle("subtitles")}
          >
            <SubtitlesSettings ctl={render} portrait={portrait} />
          </Section>
          <Section
            title="Texto en pantalla"
            summary={textStyleSummary(render.textStyle)}
            open={open.text}
            onToggle={() => toggle("text")}
          >
            <TextStylePanel style={render.textStyle} onChange={render.setTextStyle} disabled={render.job.running} />
          </Section>
          <Section
            title="Transiciones"
            summary={transitionsSummary(transitions)}
            open={open.transitions}
            onToggle={() => toggle("transitions")}
          >
            <TransitionsPanel projectId={project.id} disabled={render.job.running} />
          </Section>
          <Section
            title="Archivos del render"
            summary={render.state?.files.some((f) => f.kind !== "thumbnail") ? "Listos" : "Sin render"}
            open={open.files}
            onToggle={() => toggle("files")}
          >
            {render.state && <RenderFiles project={project} state={render.state} />}
          </Section>
          <Section title="Marcadores" summary={state.markers.length} open={open.markers} onToggle={() => toggle("markers")}>
            <div className="grid gap-1.5">
              {state.markers.map((m) => (
                <button
                  key={`${m.time_s}-${m.name}`}
                  type="button"
                  onClick={() => seekTo(m.time_s)}
                  className="flex items-center gap-2 rounded px-1 py-1 text-left text-[12px] hover:bg-panel-2"
                >
                  <span className={cn("size-2.5 shrink-0 rotate-45 rounded-[2px]", MARKER_TONE[m.color])} />
                  <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{formatSceneTime(m.time_s)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{m.name}</span>
                    {m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                  </span>
                </button>
              ))}
            </div>
          </Section>
          <Section
            title="Exportar a editor"
            summary={`${state.exports.length}/${FORMAT_FILES.length} exportados`}
            open={open.exports}
            onToggle={() => toggle("exports")}
          >
            <div className="grid gap-2">
              {FORMAT_FILES.map((f) => {
                const done = state.exports.find((e) => e.format === f.format);
                return (
                  <div key={f.format} className="rounded-md border p-2 text-[12px]">
                    <div className="flex items-center gap-2 font-medium">
                      <FileCheck2 className={cn("size-4", done ? "text-success-foreground" : "text-subtle")} />
                      {f.label}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {done ? `timeline/${done.file} · ${exportedAt(done.updated_at)}` : "Sin exportar"}
                    </div>
                    <div className="text-[11px] text-subtle">{f.hint}</div>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">Usa «Exportar timeline» en la barra de abajo.</p>
            </div>
          </Section>
        </aside>
      </div>

      {/* Pistas con cabezal: clic o arrastre para ir a ese momento */}
      <Tracks
        duration={d}
        time={clock.time}
        onSeek={seekTo}
        rows={[
          {
            id: "video",
            icon: Film,
            label: "Video",
            height: "h-14",
            content: (
              <>
                {state.scenes.map((s) => (
                  <SceneBlock
                    key={s.position}
                    scene={s}
                    duration={d}
                    onSeek={() => seekTo(s.start_s)}
                    onTrim={canTrim && s.is_video ? () => openTrim(s) : undefined}
                  />
                ))}
                <CutMarkers projectId={project.id} duration={d} disabled={render.job.running} />
              </>
            ),
          },
          {
            id: "subtitles",
            icon: Captions,
            label: "Subtítulos",
            height: "h-7",
            content:
              render.burnSubtitles && groups.length ? (
                groups.map((g) => (
                  <button
                    key={`${g[0].start}`}
                    type="button"
                    data-track-item
                    title={`${g.map((w) => w.text).join(" ")}
Clic: ir aquí y editar el estilo`}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(g[0].start);
                      editSubtitles();
                    }}
                    aria-label={`Subtítulo: ${g.map((w) => w.text).join(" ")}`}
                    className="absolute inset-y-1.5 rounded-sm border-x border-[#e8c374]/40 bg-[#e8c374]/25 hover:bg-[#e8c374]/50"
                    style={{ left: `${pct(g[0].start, d)}%`, width: `${pct(g[g.length - 1].end - g[0].start, d)}%` }}
                  />
                ))
              ) : (
                <button
                  type="button"
                  data-track-item
                  onClick={(e) => {
                    e.stopPropagation();
                    editSubtitles();
                  }}
                  className="absolute inset-y-0 left-2 flex items-center text-[11px] text-subtle hover:text-foreground"
                >
                  {state.has_voice ? "Subtítulos sin quemar · clic para configurarlos" : "Sin voz: no hay subtítulos"}
                </button>
              ),
          },
          {
            id: "markers",
            icon: Type,
            label: "Marcadores",
            height: "h-6",
            content: state.markers.map((m) => (
              <span
                key={`${m.time_s}-${m.name}`}
                title={m.note ? `${m.name}\n${m.note}` : m.name}
                className={cn("absolute top-1.5 size-3 -translate-x-1/2 rotate-45 rounded-[2px]", MARKER_TONE[m.color])}
                style={{ left: `calc(${pct(m.time_s, d)}% + 6px)` }}
              />
            )),
          },
          { id: "sfx", icon: Volume2, label: "SFX", height: "h-7", content: <SoundClips clips={state.sfx ?? []} duration={d} testId="track-sfx" tone="bg-[#b58be0]/25 text-[#c7a6ea]" empty="Sin efectos" /> },
          { id: "music", icon: Music, label: "Música", height: "h-7", content: <SoundClips clips={state.music ?? []} duration={d} testId="track-music" tone="bg-[#5aa6d6]/20 text-[#7fbde4]" empty="Sin música" /> },
          {
            id: "voice",
            icon: AudioLines,
            label: "Voz",
            height: "h-8",
            content: state.has_voice ? (
              <div
                className="absolute inset-y-1.5 left-0 flex items-center rounded-sm bg-success-foreground/20 px-2 text-[11px] text-success-foreground"
                style={{ width: `${pct(state.voice_duration_s ?? 0, d)}%` }}
              >
                voz · {formatDuration(state.voice_duration_s)}
              </div>
            ) : (
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-subtle">
                Sin voz: se usan los tiempos estimados
              </span>
            ),
          },
        ]}
      />
      <TrimDialog projectId={project.id} target={trim} onClose={() => setTrim(null)} />
    </div>
  );
}

interface TrackRow {
  id: string;
  icon: typeof Film;
  label: string;
  height: string;
  content: React.ReactNode;
}

function Tracks({
  duration,
  time,
  onSeek,
  rows,
}: {
  duration: number;
  time: number;
  onSeek: (t: number) => void;
  rows: TrackRow[];
}) {
  const area = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const at = (clientX: number) => {
    const rect = area.current!.getBoundingClientRect();
    return ((clientX - rect.left) / (rect.width || 1)) * duration;
  };
  return (
    <div className="shrink-0 border-t bg-panel">
      <div className="grid grid-cols-[96px_minmax(0,1fr)]">
        <div className="grid">
          <div className="h-6 border-b" />
          {rows.map((r) => (
            <div key={r.id} className={cn("flex items-center gap-1.5 border-r border-b px-2 text-[11px] text-muted-foreground", r.height)}>
              <r.icon className="size-3.5" /> {r.label}
            </div>
          ))}
        </div>
        <div
          ref={area}
          data-testid="tracks"
          className="relative cursor-text select-none"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-track-item]")) return;
            scrubbing.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            onSeek(at(e.clientX));
          }}
          onPointerMove={(e) => scrubbing.current && onSeek(at(e.clientX))}
          onPointerUp={() => (scrubbing.current = false)}
        >
          <div className="relative h-6 border-b">
            {rulerTicks(duration).map((t) => (
              <span
                key={t}
                className="absolute top-1 -translate-x-1/2 font-mono text-[10px] text-subtle first:translate-x-0"
                style={{ left: `${pct(t, duration)}%` }}
              >
                {formatDuration(t)}
              </span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.id} className={cn("relative border-b", r.height)} data-testid={`track-${r.id}`}>
              {r.content}
            </div>
          ))}
          {/* Cabezal */}
          <div
            data-testid="playhead"
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand"
            style={{ left: `${pct(time, duration)}%` }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneBlock({
  scene,
  duration,
  onSeek,
  onTrim,
}: {
  scene: TimelineScene;
  duration: number;
  onSeek: () => void;
  onTrim?: () => void;
}) {
  const clipPart = scene.clip_duration_s != null ? scene.clip_duration_s / scene.duration_s : 0;
  const thumb = coreUrl(scene.thumb_url);
  const label = `Escena ${scene.position} · ${formatSceneTime(scene.start_s)} · ${scene.file_name ?? scene.text ?? "sin medio"}`;
  return (
    <div
      data-track-item
      role="button"
      tabIndex={0}
      aria-label={`Ir a la escena ${scene.position}`}
      className="group absolute inset-y-1 cursor-pointer px-px"
      style={{ left: `${pct(scene.start_s, duration)}%`, width: `${pct(scene.duration_s, duration)}%` }}
      title={label}
      onClick={onSeek}
      onKeyDown={(e) => e.key === "Enter" && onSeek()}
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
        {onTrim && (
          <button
            type="button"
            aria-label={`Ajustar tramo de la escena ${scene.position}`}
            title="Ajustar el tramo del video"
            onClick={(e) => {
              e.stopPropagation();
              onTrim();
            }}
            className="absolute top-0.5 right-0.5 rounded bg-black/50 p-0.5 text-white/80 hover:bg-brand hover:text-primary-foreground"
          >
            <Scissors className="size-3" />
          </button>
        )}
        {!scene.file_name && scene.text && (
          <span className="relative block truncate px-1 text-[11px] italic text-[#e8c374]">«{scene.text}»</span>
        )}
      </div>
    </div>
  );
}

function SoundClips({
  clips,
  duration,
  testId,
  tone,
  empty,
}: {
  clips: TimelineSound[];
  duration: number;
  testId: string;
  tone: string;
  empty: string;
}) {
  return (
    <div className="absolute inset-0" data-testid={testId}>
      {clips.length === 0 && (
        <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-subtle">{empty}</span>
      )}
      {clips.map((c) => (
        <div
          key={`${c.start_s}-${c.name}`}
          title={`${c.name} · ${formatSceneTime(c.start_s)}`}
          className={cn("absolute inset-y-1 truncate rounded-sm px-1.5 text-[10px] leading-5", tone)}
          style={{ left: `${pct(c.start_s, duration)}%`, width: `max(${pct(c.duration_s, duration)}%, 4px)` }}
        >
          {c.name}
        </div>
      ))}
    </div>
  );
}

/** Avisos del timeline: uno se muestra entero; varios, en una línea que se despliega. */
function TimelineWarnings({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 1) return <NoticeBanner>{warnings[0]}</NoticeBanner>;
  return (
    <NoticeBanner
      action={
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Ocultar" : "Ver detalles"}
        </Button>
      }
    >
      {warnings.length} avisos en el timeline
      {open && (
        <ul className="mt-1 grid max-h-32 gap-0.5 overflow-y-auto text-[12px] text-muted-foreground">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </NoticeBanner>
  );
}
