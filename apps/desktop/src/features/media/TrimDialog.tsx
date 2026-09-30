import { ArrowRight, LoaderCircle, Maximize2, Pause, Play, Scissors, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import { useExtendToNextScene, useFraming, useSaveFraming } from "@/hooks/useFraming";
import { coreUrl, type FramingState } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  centerRangeAt,
  fitToScene,
  initialRange,
  MIN_TRIM_S,
  moveRange,
  remainingAfterScene,
  resizeEnd,
  resizeStart,
  toPct,
  type TrimRange,
  trimToSave,
} from "./trimMeta";

export interface TrimTarget {
  sceneId: number;
  assetId: number;
  fileUrl: string;
  position?: number;
}

/**
 * «Ajustar tramo»: vista previa del video y, debajo, la tira de fotogramas del clip completo con
 * una ventana del largo de la escena que se arrastra (y se puede estirar por los bordes).
 */
export function TrimDialog({
  projectId,
  target,
  queue,
  onClose,
}: {
  projectId: number;
  target: TrimTarget | null;
  /** «2 de 5» cuando se abren varios seguidos tras descargar. */
  queue?: { index: number; total: number };
  onClose: () => void;
}) {
  const { data: state } = useFraming(target?.sceneId ?? 0, target?.assetId ?? null);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-4xl">
        {target && state && state.asset_id === target.assetId && state.source_duration_s ? (
          <TrimEditor
            key={`${target.sceneId}-${target.assetId}`}
            projectId={projectId}
            state={state}
            target={target}
            queue={queue}
            onClose={onClose}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>Ajustar tramo</DialogTitle>
            <DialogDescription>Cargando el video…</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Drag = { kind: "move" | "start" | "end"; x0: number; range0: TrimRange };

function TrimEditor({
  projectId,
  state,
  target,
  queue,
  onClose,
}: {
  projectId: number;
  state: FramingState;
  target: TrimTarget;
  queue?: { index: number; total: number };
  onClose: () => void;
}) {
  const duration = state.source_duration_s!;
  const sceneDuration = state.scene_duration_s ?? null;
  const [range, setRange] = useState<TrimRange>(() =>
    initialRange(duration, sceneDuration, state.trim_in_s, state.trim_out_s),
  );
  const [playing, setPlaying] = useState(false);
  const [stripReady, setStripReady] = useState(false);
  const [now, setNow] = useState(range.start);
  const [confirmExtend, setConfirmExtend] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const save = useSaveFraming(projectId);
  const extend = useExtendToNextScene(projectId);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const length = range.end - range.start;
  const mismatch = sceneDuration != null && Math.abs(length - sceneDuration) > 0.25;
  const vertical = state.target_height > state.target_width;
  const remaining = sceneDuration != null ? remainingAfterScene(duration, sceneDuration, range.start) : 0;
  const canExtend = state.can_extend_next && remaining >= MIN_TRIM_S;

  // Bucle dentro del tramo.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      const r = rangeRef.current;
      if (v.currentTime >= r.end || v.currentTime < r.start - 0.05) v.currentTime = r.start;
      setNow(v.currentTime);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const seek = (t: number) => {
    if (video.current) video.current.currentTime = t;
    setNow(t);
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < range.start || v.currentTime >= range.end) v.currentTime = range.start;
      void v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const secondsPerPx = () => duration / (track.current?.getBoundingClientRect().width || 1);

  const startDrag = (kind: Drag["kind"]) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind, x0: e.clientX, range0: range };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = (e.clientX - d.x0) * secondsPerPx();
    const next =
      d.kind === "move"
        ? moveRange(d.range0, delta, duration)
        : d.kind === "start"
          ? resizeStart(d.range0, d.range0.start + delta)
          : resizeEnd(d.range0, d.range0.end + delta, duration);
    setRange(next);
    // Vista previa en vivo: el fotograma del borde que se mueve.
    seek(d.kind === "end" ? Math.max(next.end - 0.05, next.start) : next.start);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const clickTrack = (e: React.MouseEvent) => {
    const rect = track.current!.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    const next = centerRangeAt(range, t, duration);
    setRange(next);
    seek(next.start);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const next = moveRange(range, e.key === "ArrowLeft" ? -step : step, duration);
      setRange(next);
      seek(next.start);
      e.preventDefault();
    } else if (e.key === " ") {
      togglePlay();
      e.preventDefault();
    }
  };

  const submit = () =>
    save.mutate(
      {
        sceneId: state.scene_id,
        assetId: state.asset_id,
        input: { mode: state.mode, crop: state.crop, ...trimToSave(range, duration) },
      },
      {
        onSuccess: (r) => {
          toast.success(
            r.job ? "Tramo guardado: preparando el video en segundo plano…" : `Tramo ${formatSceneTime(range.start)}–${formatSceneTime(range.end)} guardado`,
          );
          onClose();
        },
      },
    );

  const runExtend = () =>
    extend.mutate(
      {
        sceneId: state.scene_id,
        assetId: state.asset_id,
        input: { mode: state.mode, crop: state.crop, ...trimToSave(range, duration) },
      },
      {
        onSuccess: (r) => {
          toast.success(
            `Escena ${r.next_scene_position}: sigue con ${remaining.toFixed(1)} s del mismo video`,
          );
          onClose();
        },
      },
    );

  const strip = coreUrl(`/api/assets/${state.asset_id}/filmstrip?frames=16`);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Scissors className="size-4 text-brand" />
          Ajustar tramo{target.position != null && ` · Escena ${target.position}`}
          {queue && queue.total > 1 && (
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              {queue.index + 1} de {queue.total}
            </span>
          )}
        </DialogTitle>
        <DialogDescription>
          El clip dura {formatSceneTime(duration)}
          {sceneDuration != null && <> y la escena {sceneDuration.toFixed(1)} s</>}. Arrastra la franja naranja sobre
          los fotogramas hasta el momento exacto; la vista previa repite solo ese tramo.
        </DialogDescription>
      </DialogHeader>

      <div className="flex justify-center rounded-md bg-black/60 p-2">
        <video
          ref={video}
          src={coreUrl(target.fileUrl)}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => seek(range.start)}
          onPause={() => setPlaying(false)}
          className={cn("rounded object-contain", vertical ? "h-[42vh] max-h-[420px]" : "max-h-[40vh] w-full")}
        />
      </div>

      {/* Línea de tiempo con la tira de fotogramas */}
      <div
        tabIndex={0}
        role="group"
        aria-label="Línea de tiempo del clip"
        onKeyDown={onKey}
        className="grid gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex justify-between font-mono text-[11px] text-subtle">
          <span>0:00.0</span>
          <span>{formatSceneTime(duration)}</span>
        </div>
        <div
          ref={track}
          data-testid="trim-track"
          onClick={clickTrack}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative mt-5 h-16 cursor-pointer rounded-md bg-panel-2"
        >
          <img
            src={strip}
            alt=""
            data-testid="trim-strip"
            draggable={false}
            onLoad={() => setStripReady(true)}
            onError={() => setStripReady(true)}
            className="pointer-events-none absolute inset-0 size-full rounded-md object-fill"
          />
          {!stripReady && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Generando fotogramas…
            </span>
          )}
          {/* Zonas fuera del tramo, oscurecidas */}
          <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-black/65" style={{ width: `${toPct(range.start, duration)}%` }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-black/65" style={{ width: `${100 - toPct(range.end, duration)}%` }} />
          {/* Ventana del tramo */}
          <div
            data-testid="trim-window"
            role="slider"
            aria-label="Tramo elegido"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={range.start}
            aria-valuetext={`${formatSceneTime(range.start)} a ${formatSceneTime(range.end)}`}
            onPointerDown={startDrag("move")}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 cursor-grab border-2 border-brand bg-brand/10 active:cursor-grabbing"
            // Ancho mínimo visible aunque el tramo sea muy corto frente al clip.
            style={{ left: `${toPct(range.start, duration)}%`, width: `${toPct(length, duration)}%`, minWidth: 18 }}
          >
            <span
              aria-label="Mover el inicio"
              onPointerDown={startDrag("start")}
              className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize rounded-l bg-brand"
            />
            <span
              aria-label="Mover el final"
              onPointerDown={startDrag("end")}
              className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize rounded-r bg-brand"
            />
            <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-brand px-1.5 font-mono text-[10px] font-medium whitespace-nowrap text-primary-foreground">
              {length.toFixed(1)} s
            </span>
          </div>
          {/* Cabezal de reproducción */}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]"
            style={{ left: `${toPct(now, duration)}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Button size="sm" variant="outline" onClick={togglePlay} aria-label={playing ? "Pausar" : "Reproducir el tramo"}>
            {playing ? <Pause /> : <Play />}
            {playing ? "Pausar" : "Reproducir el tramo"}
          </Button>
          <span className="font-mono" data-testid="trim-times">
            {formatSceneTime(range.start)} – {formatSceneTime(range.end)}
          </span>
          {mismatch && (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5" />
              El tramo dura {length.toFixed(1)} s y la escena {sceneDuration!.toFixed(1)} s
            </span>
          )}
          <span className="ml-auto text-subtle">← → mueve 0,1 s · Mayús + ← → 1 s · Espacio reproduce</span>
        </div>
      </div>

      {canExtend && (
        <div
          data-testid="extend-next"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-brand/40 bg-brand/5 px-3 py-2 text-[12px]"
        >
          <span className="flex items-center gap-1.5">
            <ArrowRight className="size-3.5 shrink-0 text-brand" />
            Sobran {remaining.toFixed(1)} s de metraje: pueden seguir en la escena{" "}
            {state.next_scene_position}
            {state.next_scene_has_media && " (reemplazando su medio actual)"}.
          </span>
          {confirmExtend ? (
            <div className="flex shrink-0 gap-2">
              <Button size="xs" variant="ghost" onClick={() => setConfirmExtend(false)}>
                Cancelar
              </Button>
              <Button size="xs" onClick={runExtend} disabled={extend.isPending}>
                {extend.isPending && <LoaderCircle className="animate-spin" />}
                Sí, reemplazar y continuar
              </Button>
            </div>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={() => (state.next_scene_has_media ? setConfirmExtend(true) : runExtend())}
              disabled={extend.isPending}
            >
              {extend.isPending && <LoaderCircle className="animate-spin" />}
              Continuar en la escena {state.next_scene_position}
            </Button>
          )}
        </div>
      )}

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex gap-1">
          {sceneDuration != null && mismatch && (
            <Button variant="ghost" size="sm" onClick={() => setRange(fitToScene(range, sceneDuration, duration))}>
              Ajustar al largo de la escena
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setRange({ start: 0, end: duration })}>
            <Maximize2 /> Usar el clip completo
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {queue && queue.total > 1 ? "Saltar" : "Cancelar"}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Guardar tramo
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
