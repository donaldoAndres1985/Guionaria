import { Ban, Check, Clapperboard, Copy, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND_LABEL } from "@/features/scenes/sceneMeta";
import type { OverlayEditing } from "@/hooks/useOverlays";
import { coreUrl, type TimelineScene, type TransitionCut, type TransitionsState } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EFFECT_CATALOG, EFFECT_CATEGORIES, type EffectCategory, effectLabel } from "./effectsCatalog";
import { effectLook, transitionLook } from "./previewMeta";

export type EffectsTab = "effect" | "transition";

export interface EffectsTarget {
  scene: TimelineScene;
  tab: EffectsTab;
}

const PREVIEW_ZOOM = 0.12;

/** Reloj en bucle para las vistas previas animadas del diálogo (0 → `period`). */
function useLoop(period: number, running = true) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running || period <= 0) return;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setT(((now - t0) / 1000) % period);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [period, running]);
  return t;
}

function Thumb({ scene, className, style }: { scene: TimelineScene | undefined; className?: string; style?: React.CSSProperties }) {
  const url = coreUrl(scene?.thumb_url);
  return url ? (
    <img src={url} alt="" draggable={false} className={cn("absolute inset-0 size-full object-cover", className)} style={style} />
  ) : (
    <div className={cn("absolute inset-0 flex items-center justify-center bg-black p-2 text-center text-[11px] text-[#e8c374]", className)} style={style}>
      {scene?.text ? `«${scene.text}»` : ""}
    </div>
  );
}

/** Miniatura de la escena con el efecto aplicado en el instante `p` (0–1) de una escena de `seconds`. */
export function EffectFrame({ scene, effect, p, seconds }: { scene: TimelineScene | undefined; effect: string | null; p: number; seconds: number }) {
  const look = effectLook(effect, p, PREVIEW_ZOOM, seconds);
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <Thumb scene={scene} style={{ transform: look.transform, filter: look.filter }} />
      {(look.vignette ?? 0) > 0 && (
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${look.vignette}) 100%)` }} />
      )}
      {(look.bars ?? 0) > 0 && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black" style={{ height: `${(look.bars ?? 0) * 100}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${(look.bars ?? 0) * 100}%` }} />
        </>
      )}
      {look.fade > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: look.fade }} />}
      {(look.flash ?? 0) > 0 && <div className="absolute inset-0 bg-white" style={{ opacity: look.flash }} />}
    </div>
  );
}

/** Dos escenas fundiéndose con la transición `kind` en el punto `x` (0–1). */
function TransitionFrame({ from, to, kind, x }: { from: TimelineScene | undefined; to: TimelineScene | undefined; kind: string | null; x: number }) {
  const look = kind ? transitionLook(kind, x) : { incoming: { opacity: x >= 0.5 ? 1 : 0 }, outgoing: {} };
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div className="absolute inset-0" style={{ ...look.outgoing, zIndex: look.outgoingOnTop ? 2 : 1 }}>
        <Thumb scene={from} />
      </div>
      <div className="absolute inset-0" style={{ ...look.incoming, zIndex: look.outgoingOnTop ? 1 : 2 }}>
        <Thumb scene={to} />
      </div>
      {look.overlay && <div className="absolute inset-0 z-[3]" style={{ background: look.overlay.color, opacity: look.overlay.opacity }} />}
    </div>
  );
}

/**
 * Efecto de una escena y transiciones con sus vecinas, como el panel de CapCut: se elige en una
 * cuadrícula con vista previa animada y se aplica al momento (el render usa lo mismo).
 */
export function EffectsDialog({
  target,
  scenes,
  transitions,
  editing,
  portrait,
  editable,
  onTab,
  onClose,
}: {
  target: EffectsTarget | null;
  scenes: TimelineScene[];
  transitions: TransitionsState | undefined;
  editing: OverlayEditing;
  portrait: boolean;
  editable: boolean;
  onTab: (tab: EffectsTab) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-5xl" aria-describedby={undefined}>
        {target && (
          <EffectsBody
            key={target.scene.position}
            target={target}
            scenes={scenes}
            transitions={transitions}
            editing={editing}
            portrait={portrait}
            editable={editable}
            onTab={onTab}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EffectsBody({
  target,
  scenes,
  transitions,
  editing,
  portrait,
  editable,
  onTab,
  onClose,
}: {
  target: EffectsTarget;
  scenes: TimelineScene[];
  transitions: TransitionsState | undefined;
  editing: OverlayEditing;
  portrait: boolean;
  editable: boolean;
  onTab: (tab: EffectsTab) => void;
  onClose: () => void;
}) {
  const scene = scenes.find((s) => s.position === target.scene.position) ?? target.scene;
  const index = scenes.findIndex((s) => s.position === scene.position);
  const prev = index > 0 ? scenes[index - 1] : undefined;
  const next = index >= 0 && index < scenes.length - 1 ? scenes[index + 1] : undefined;
  const aspect = portrait ? "aspect-[9/16]" : "aspect-video";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand" /> Escena {scene.position} · {KIND_LABEL[scene.kind]}
        </DialogTitle>
        <DialogDescription>Elige un efecto o una transición: se aplica al momento y el render usa lo mismo.</DialogDescription>
      </DialogHeader>
      <div role="tablist" aria-label="Efectos y transiciones" className="flex w-fit rounded-md border p-0.5 text-[12px]">
        {(
          [
            ["effect", "Efecto"],
            ["transition", "Transición"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={target.tab === id}
            onClick={() => onTab(id)}
            className={cn("rounded px-4 py-1", target.tab === id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2")}
          >
            {label}
          </button>
        ))}
      </div>
      {target.tab === "effect" ? (
        <EffectTab scene={scene} scenes={scenes} editing={editing} aspect={aspect} editable={editable} />
      ) : (
        <TransitionTab scene={scene} prev={prev} next={next} transitions={transitions} editing={editing} aspect={aspect} editable={editable} />
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>
          <Check /> Listo
        </Button>
      </div>
    </>
  );
}

function EffectTab({
  scene,
  scenes,
  editing,
  aspect,
  editable,
}: {
  scene: TimelineScene;
  scenes: TimelineScene[];
  editing: OverlayEditing;
  aspect: string;
  editable: boolean;
}) {
  const [category, setCategory] = useState<EffectCategory | "all">("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const current = scene.effect ?? null;
  const shown = hovered ?? current;
  const seconds = Math.min(Math.max(scene.duration_s, 1.5), 4);
  const t = useLoop(seconds + 0.6);
  const p = Math.min(t / seconds, 1);
  const isVideo = !!scene.is_video;
  const list = EFFECT_CATALOG.filter((e) => category === "all" || e.category === category);
  const sameKind = scenes.filter((s) => s.scene_id != null && s.kind === scene.kind && !!s.file_name === !!scene.file_name);

  const apply = (effect: string) => {
    if (!editable || scene.scene_id == null) return;
    editing.setEffect.mutate({ sceneId: scene.scene_id, effect });
  };
  const applyToAll = async () => {
    if (!editable) return;
    const effect = current ?? "ninguno";
    const ids = sameKind.map((s) => s.scene_id!).filter((id) => id !== scene.scene_id);
    await Promise.all(ids.map((id) => editing.setEffect.mutateAsync({ sceneId: id, effect })));
    toast.success(`«${effectLabel(current)}» en ${ids.length + 1} escenas de tipo ${KIND_LABEL[scene.kind].toLowerCase()}`);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <div className={cn("relative w-full overflow-hidden rounded-md border", aspect)} data-testid="effect-preview">
          <EffectFrame scene={scene} effect={shown} p={p} seconds={seconds} />
          <span className="absolute bottom-1.5 left-1.5 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">{effectLabel(shown)}</span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Actual: <span className="font-medium text-foreground">{effectLabel(current)}</span>
        </p>
        {sameKind.length > 1 && (
          <Button size="sm" variant="outline" disabled={!editable || editing.setEffect.isPending} onClick={() => void applyToAll()}>
            <Copy /> Aplicar a las {sameKind.length} escenas de tipo {KIND_LABEL[scene.kind].toLowerCase()}
          </Button>
        )}
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Categorías de efectos">
          {[{ id: "all" as const, label: "Todos" }, ...EFFECT_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px]",
                category === c.id ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="grid max-h-[52vh] grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 overflow-y-auto pr-1" aria-label="Efectos">
          <EffectCard label="Sin efecto" hint="La escena tal cual" selected={!current} disabled={!editable} onPick={() => apply("ninguno")} onHover={(h) => setHovered(h ? "ninguno" : null)}>
            <Thumb scene={scene} />
            <Ban className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-white/80 drop-shadow" />
          </EffectCard>
          {list.map((e) => {
            const blocked = e.videoOnly && !isVideo;
            return (
              <EffectCard
                key={e.id}
                label={e.label}
                hint={blocked ? "Solo para videos" : e.hint}
                selected={current === e.id}
                disabled={!editable || blocked}
                onPick={() => apply(e.id)}
                onHover={(h) => setHovered(h && !blocked ? e.id : null)}
              >
                <EffectFrame scene={scene} effect={e.id} p={hovered === e.id ? p : 0.55} seconds={seconds} />
              </EffectCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EffectCard({
  label,
  hint,
  selected,
  disabled,
  onPick,
  onHover,
  children,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
  onHover: (hovered: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={hint}
      disabled={disabled}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        "group overflow-hidden rounded-md border bg-background text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        selected ? "border-brand ring-1 ring-brand" : "hover:border-foreground/30",
      )}
    >
      <div className="relative aspect-video overflow-hidden">{children}</div>
      <div className="flex items-center gap-1 px-1.5 py-1 text-[11px] font-medium">
        {selected && <Check className="size-3 shrink-0 text-brand" />}
        <span className="truncate">{label}</span>
      </div>
    </button>
  );
}

function TransitionTab({
  scene,
  prev,
  next,
  transitions,
  editing,
  aspect,
  editable,
}: {
  scene: TimelineScene;
  prev: TimelineScene | undefined;
  next: TimelineScene | undefined;
  transitions: TransitionsState | undefined;
  editing: OverlayEditing;
  aspect: string;
  editable: boolean;
}) {
  const [side, setSide] = useState<"out" | "in">(next ? "out" : "in");
  const from = side === "out" ? scene : prev;
  const to = side === "out" ? next : scene;
  const cut: TransitionCut | undefined = transitions?.cuts.find((c) => from && c.scene_id === from.scene_id);
  const [hovered, setHovered] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => setSeconds(null), [cut?.chosen_s, cut?.scene_id, transitions?.duration]);

  const defaultId = transitions?.default ?? "none";
  const applied = cut?.chosen ?? null; // null = la de por defecto
  const effective = hovered ?? (applied ?? defaultId);
  const kind = effective === "none" ? null : effective;
  const length = seconds ?? cut?.chosen_s ?? transitions?.duration ?? 0.5;
  const period = 0.7 + Math.max(length, 0.3) + 0.9;
  const t = useLoop(period);
  const x = Math.min(Math.max((t - 0.7) / Math.max(length, 0.3), 0), 1);
  const label = (id: string | null) => (id === null ? "Corte directo" : (transitions?.options.find((o) => o.id === id)?.label ?? id));

  const options = useMemo(() => transitions?.options ?? [], [transitions?.options]);
  if (!transitions) return null;
  if (!prev && !next) return <p className="text-[13px] text-muted-foreground">Es la única escena: no hay cortes.</p>;

  const pick = (id: string | null) => {
    if (!editable || !from?.scene_id) return;
    editing.setCut.mutate({ sceneId: from.scene_id, transition: id });
  };
  const saveLength = (value: number | null) => {
    if (!editable || !from?.scene_id) return;
    editing.setCut.mutate({ sceneId: from.scene_id, duration_s: value });
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <div role="radiogroup" aria-label="Qué corte" className="grid grid-cols-2 gap-1 rounded-md border p-0.5 text-[12px]">
          <button type="button" role="radio" aria-checked={side === "in"} disabled={!prev} onClick={() => setSide("in")} className={cn("rounded px-2 py-1 disabled:opacity-40", side === "in" ? "bg-active text-active-foreground" : "text-muted-foreground")}>
            Entrada {prev ? `(${prev.position} → ${scene.position})` : ""}
          </button>
          <button type="button" role="radio" aria-checked={side === "out"} disabled={!next} onClick={() => setSide("out")} className={cn("rounded px-2 py-1 disabled:opacity-40", side === "out" ? "bg-active text-active-foreground" : "text-muted-foreground")}>
            Salida {next ? `(${scene.position} → ${next.position})` : ""}
          </button>
        </div>
        <div className={cn("relative w-full overflow-hidden rounded-md border", aspect)} data-testid="transition-preview">
          <TransitionFrame from={from} to={to} kind={kind} x={x} />
          <span className="absolute bottom-1.5 left-1.5 z-10 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">{label(kind)}</span>
        </div>
        <label className="grid gap-1 text-[12px] text-muted-foreground">
          <span className="flex justify-between">
            Duración de este corte <span className="font-mono text-foreground">{length.toFixed(1)} s</span>
          </span>
          <input
            type="range"
            aria-label="Duración de esta transición"
            min={0.2}
            max={2}
            step={0.1}
            value={length}
            disabled={!editable || !kind}
            onChange={(e) => setSeconds(Number(e.target.value))}
            onPointerUp={() => {
              if (seconds !== null) saveLength(seconds);
            }}
            onKeyUp={() => seconds !== null && saveLength(seconds)}
            className="accent-[var(--accent)]"
          />
          <span className="flex items-center justify-between text-[11px] text-subtle">
            {cut?.chosen_s ? "Duración propia" : `Por defecto (${(transitions.duration ?? 0.5).toFixed(1)} s)`}
            {cut?.chosen_s ? (
              <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => saveLength(null)}>
                Usar la de por defecto
              </button>
            ) : null}
          </span>
          {cut && cut.transition && cut.duration_s < length - 0.05 && (
            <span className="text-[11px] text-warning">Las escenas son cortas: en el video dura {cut.duration_s.toFixed(1)} s.</span>
          )}
        </label>
      </div>
      <div className="grid max-h-[58vh] min-w-0 content-start grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 overflow-y-auto pr-1" aria-label="Transiciones">
        <EffectCard
          label={`Por defecto (${label(defaultId === "none" ? null : defaultId)})`}
          hint="La de Ajustes → Transiciones"
          selected={applied === null}
          disabled={!editable}
          onPick={() => pick(null)}
          onHover={(h) => setHovered(h ? defaultId : null)}
        >
          <TransitionFrame from={from} to={to} kind={defaultId === "none" ? null : defaultId} x={hovered === defaultId ? x : 0.5} />
        </EffectCard>
        {options.map((o) => (
          <EffectCard
            key={o.id}
            label={o.label}
            hint={o.id === "none" ? "Sin transición" : o.label}
            selected={applied === o.id}
            disabled={!editable}
            onPick={() => pick(o.id)}
            onHover={(h) => setHovered(h ? o.id : null)}
          >
            {o.id === "none" ? (
              <>
                <TransitionFrame from={from} to={to} kind={null} x={0.6} />
                <Clapperboard className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-white/80 drop-shadow" />
              </>
            ) : (
              <TransitionFrame from={from} to={to} kind={o.id} x={hovered === o.id ? x : 0.5} />
            )}
          </EffectCard>
        ))}
      </div>
    </div>
  );
}
