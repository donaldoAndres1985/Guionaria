import { Pencil, Plus, Trash2, Type, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import type { OverlayItem, OverlayTrack } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pct } from "./timelineMeta";

export const MIN_ITEM_S = 0.2;
const SNAP_PX = 7;

/** Encabezado de una pista propia: nombre (doble clic para renombrar), agregar y borrar. */
export function OverlayTrackHeader({
  track,
  editable,
  onAdd,
  onRename,
  onDelete,
}: {
  track: OverlayTrack;
  editable: boolean;
  onAdd: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(track.name);
  const [confirm, setConfirm] = useState(false);
  const Icon = track.kind === "text" ? Type : Volume2;
  const commit = () => {
    setEditingName(false);
    const value = name.trim();
    if (value && value !== track.name) onRename(value);
    else setName(track.name);
  };
  return (
    <div className="group flex min-w-0 flex-1 items-center gap-1" data-testid={`overlay-track-header-${track.id}`}>
      <Icon className="size-3.5 shrink-0 text-brand" />
      {editingName ? (
        <input
          autoFocus
          aria-label="Nombre de la pista"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setName(track.name);
              setEditingName(false);
            }
          }}
          className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-[11px] text-foreground"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate"
          title={`${track.name} · doble clic para renombrar`}
          onDoubleClick={() => editable && setEditingName(true)}
        >
          {track.name}
        </span>
      )}
      {editable && !editingName && (
        <span className="flex shrink-0 opacity-70 group-hover:opacity-100">
          <button type="button" aria-label={`Agregar a ${track.name}`} title={track.kind === "text" ? "Agregar texto en el cabezal" : "Agregar sonido en el cabezal"} onClick={onAdd} className="rounded p-0.5 hover:bg-panel-2 hover:text-foreground">
            <Plus className="size-3.5" />
          </button>
          <button type="button" aria-label={`Renombrar ${track.name}`} title="Renombrar" onClick={() => setEditingName(true)} className="hidden rounded p-0.5 hover:bg-panel-2 hover:text-foreground xl:block">
            <Pencil className="size-3" />
          </button>
          <button type="button" aria-label={`Eliminar la pista ${track.name}`} title="Eliminar la pista" onClick={() => setConfirm(true)} className="rounded p-0.5 hover:bg-panel-2 hover:text-danger">
            <Trash2 className="size-3.5" />
          </button>
        </span>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`¿Eliminar la pista «${track.name}»?`}
        description={
          track.items.length
            ? `Se borra con sus ${track.items.length} ${track.kind === "text" ? "textos" : "sonidos"}. Las pistas de Guionaria no cambian.`
            : "La pista está vacía. Las pistas de Guionaria no cambian."
        }
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => {
          setConfirm(false);
          onDelete();
        }}
      />
    </div>
  );
}

type Drag = { id: number; kind: "move" | "start" | "end"; x0: number; start0: number; dur0: number; moved: boolean };

/**
 * Elementos de una pista propia sobre la línea de tiempo: se arrastran para moverlos, se
 * estiran por los bordes (se pegan a cortes, cabezal y otros elementos) y un clic los abre.
 */
export function OverlayTrackLane({
  track,
  duration,
  snapPoints,
  editable,
  selectedId,
  onSelect,
  onOpen,
  onChange,
}: {
  track: OverlayTrack;
  duration: number;
  /** Cortes de escena, cabezal y bordes de los otros elementos (segundos). */
  snapPoints: number[];
  editable: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onOpen: (item: OverlayItem) => void;
  onChange: (item: OverlayItem, patch: { start_s?: number; duration_s?: number }) => void;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ id: number; start: number; dur: number } | null>(null);

  const perPx = () => duration / (lane.current?.getBoundingClientRect().width || 1);
  const snap = (t: number, exclude: number) => {
    const limit = SNAP_PX * perPx();
    let best = t;
    let dist = limit;
    for (const p of snapPoints) {
      if (Math.abs(p - exclude) < 1e-6) continue;
      const d = Math.abs(p - t);
      if (d < dist) {
        best = p;
        dist = d;
      }
    }
    return best;
  };

  const begin = (item: OverlayItem, kind: Drag["kind"]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(item.id);
    if (!editable) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { id: item.id, kind, x0: e.clientX, start0: item.start_s, dur0: item.duration_s, moved: false };
  };

  const move = (item: OverlayItem) => (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== item.id) return;
    const delta = (e.clientX - d.x0) * perPx();
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const maxDur = item.sound_duration_s ?? Number.POSITIVE_INFINITY;
    let start = d.start0;
    let dur = d.dur0;
    if (d.kind === "move") {
      start = Math.min(Math.max(d.start0 + delta, 0), Math.max(duration - d.dur0, 0));
      const snappedStart = snap(start, d.start0);
      const snappedEnd = snap(start + d.dur0, d.start0 + d.dur0);
      if (snappedStart !== start) start = snappedStart;
      else if (snappedEnd !== start + d.dur0) start = snappedEnd - d.dur0;
      start = Math.min(Math.max(start, 0), Math.max(duration - d.dur0, 0));
    } else if (d.kind === "start") {
      const end = d.start0 + d.dur0;
      start = Math.min(Math.max(snap(d.start0 + delta, d.start0), 0, end - Math.min(maxDur, 3600)), end - MIN_ITEM_S);
      dur = end - start;
    } else {
      const end = Math.min(snap(d.start0 + d.dur0 + delta, d.start0 + d.dur0), duration, d.start0 + maxDur);
      dur = Math.max(end - d.start0, MIN_ITEM_S);
    }
    setLive({ id: item.id, start: Math.round(start * 100) / 100, dur: Math.round(dur * 100) / 100 });
  };

  const end = (item: OverlayItem) => () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== item.id) return;
    if (!d.moved) {
      setLive(null);
      onOpen(item);
      return;
    }
    if (live && live.id === item.id) {
      const patch: { start_s?: number; duration_s?: number } = {};
      if (Math.abs(live.start - item.start_s) > 0.005) patch.start_s = live.start;
      if (Math.abs(live.dur - item.duration_s) > 0.005) patch.duration_s = live.dur;
      if (patch.start_s !== undefined || patch.duration_s !== undefined) onChange(item, patch);
    }
    setLive(null);
  };

  const tone = track.kind === "text" ? "bg-[#e8742a]/30 border-[#f08a3c] text-[#ffd2b0]" : "bg-[#b58be0]/30 border-[#c7a6ea] text-[#e9dcf7]";

  return (
    <div ref={lane} className="absolute inset-0" data-testid={`overlay-lane-${track.id}`}>
      {track.items.length === 0 && (
        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[11px] text-subtle">
          {track.kind === "text" ? "Pista vacía · «+» agrega un texto en el cabezal" : "Pista vacía · «+» agrega un sonido en el cabezal"}
        </span>
      )}
      {track.items.map((item) => {
        const shown = live && live.id === item.id ? { start: live.start, dur: live.dur } : { start: item.start_s, dur: item.duration_s };
        const selected = selectedId === item.id;
        const label = track.kind === "text" ? (item.text ?? "") : (item.sound_title ?? "Sonido");
        return (
          <div
            key={item.id}
            data-track-item
            role="button"
            tabIndex={0}
            aria-label={`${track.kind === "text" ? "Texto" : "Sonido"}: ${label} · ${formatSceneTime(shown.start)}`}
            aria-pressed={selected}
            title={`${label}\n${formatSceneTime(shown.start)} – ${formatSceneTime(shown.start + shown.dur)} · clic para editar, arrástralo para moverlo`}
            onPointerDown={begin(item, "move")}
            onPointerMove={move(item)}
            onPointerUp={end(item)}
            onPointerCancel={() => {
              drag.current = null;
              setLive(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && onOpen(item)}
            className={cn(
              "group absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded-sm border px-1.5 text-[10px] leading-none active:cursor-grabbing",
              tone,
              selected && "ring-2 ring-brand ring-offset-1 ring-offset-panel",
            )}
            style={{ left: `${pct(shown.start, duration)}%`, width: `max(${pct(shown.dur, duration)}%, 6px)` }}
          >
            {editable && (
              <span
                aria-label="Mover el inicio"
                onPointerDown={begin(item, "start")}
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/40"
              />
            )}
            <span className="pointer-events-none flex min-w-0 items-center gap-1 truncate">
              {track.kind === "text" ? <Type className="size-2.5 shrink-0" /> : <Volume2 className="size-2.5 shrink-0" />}
              <span className="truncate">{label}</span>
            </span>
            {editable && (
              <span
                aria-label="Mover el final"
                onPointerDown={begin(item, "end")}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/40"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
