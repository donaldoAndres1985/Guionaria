import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseUpper,
  Copy,
  Italic,
  LoaderCircle,
  Pause,
  Play,
  Trash2,
  Type,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseClock } from "@/features/media/dropUtils";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import type { OverlayEditing } from "@/hooks/useOverlays";
import { coreUrl, type OverlayItem, type TextOverlayStyle, type TimelineScene } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OverlayTextView } from "./OverlayText";
import {
  ANIMATIONS_IN,
  ANIMATIONS_OUT,
  DEFAULT_TEXT_OVERLAY,
  fontFamily,
  overlayLines,
  overlayTiming,
  POSITIONS,
  TEXT_FONTS,
  TEXT_PRESETS,
} from "./overlayMeta";

export type TextTarget = { mode: "create"; trackId: number; start_s: number } | { mode: "edit"; item: OverlayItem };

const SWATCHES = ["#FFFFFF", "#000000", "#FFD400", "#FF3B30", "#FF9500", "#34C759", "#00C7BE", "#0A84FF", "#BF5AF2", "#FF2D55"];
const SNAP = 0.015; // se pega a las guías del centro
type Tab = "text" | "style" | "edge" | "animation";

/** Editor de un texto de una pista propia, como el de CapCut: formato, posición y animación. */
export function TextOverlayDialog({
  target,
  width,
  height,
  scenes,
  totalS,
  editing,
  editable,
  lastStyle,
  onClose,
}: {
  target: TextTarget | null;
  /** Cuadro del proyecto (px). */
  width: number;
  height: number;
  scenes: TimelineScene[];
  totalS: number;
  editing: OverlayEditing;
  editable: boolean;
  /** Estilo del último texto editado: los nuevos parten de él. */
  lastStyle?: TextOverlayStyle | null;
  onClose: (saved?: TextOverlayStyle) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-6xl" aria-describedby={undefined}>
        {target && (
          <TextEditor
            key={target.mode === "edit" ? `e${target.item.id}` : `c${target.trackId}-${target.start_s}`}
            target={target}
            width={width}
            height={height}
            scenes={scenes}
            totalS={totalS}
            editing={editing}
            editable={editable}
            lastStyle={lastStyle}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TextEditor({
  target,
  width,
  height,
  scenes,
  totalS,
  editing,
  editable,
  lastStyle,
  onClose,
}: {
  target: TextTarget;
  width: number;
  height: number;
  scenes: TimelineScene[];
  totalS: number;
  editing: OverlayEditing;
  editable: boolean;
  lastStyle?: TextOverlayStyle | null;
  onClose: (saved?: TextOverlayStyle) => void;
}) {
  const editingItem = target.mode === "edit" ? target.item : null;
  const [text, setText] = useState(editingItem?.text ?? "Escribe tu texto");
  const [style, setStyle] = useState<TextOverlayStyle>(editingItem?.style ?? { ...DEFAULT_TEXT_OVERLAY, ...(lastStyle ?? {}) });
  const [start, setStart] = useState(formatSceneTime(editingItem?.start_s ?? (target.mode === "create" ? target.start_s : 0)));
  const [length, setLength] = useState(String(editingItem?.duration_s ?? 3));
  const [tab, setTab] = useState<Tab>("text");
  const [playing, setPlaying] = useState(true);
  const set = (patch: Partial<TextOverlayStyle>) => setStyle((s) => ({ ...s, ...patch }));

  const startS = parseClock(start);
  const durationS = Number(length.replace(",", "."));
  const timeError =
    startS === null || Number.isNaN(startS)
      ? "Inicio: usa minutos:segundos, por ejemplo 0:12.5"
      : !(durationS >= 0.2)
        ? "La duración debe ser de al menos 0,2 s"
        : startS >= totalS
          ? `El video dura ${formatSceneTime(totalS)}`
          : null;
  const valid = text.trim().length > 0 && !timeError;
  const duration = durationS >= 0.2 ? durationS : 3;
  const busy = editing.addItem.isPending || editing.updateItem.isPending;

  // Animación en bucle del texto (entrada, quieto y salida); en pausa se ve completo.
  const plainLength = overlayLines(text, style, width).join("\n").length;
  const { a } = overlayTiming(style, duration, plainLength);
  const local = useLocalLoop(duration, playing);
  const shownAt = playing ? local : Math.min(a + 0.05, duration / 2);

  const save = () => {
    if (!valid || !editable) return;
    const input = { text: text.trim(), style, start_s: startS ?? 0, duration_s: durationS };
    const done = { onSuccess: () => onClose(style) };
    if (editingItem) editing.updateItem.mutate({ id: editingItem.id, input }, done);
    else if (target.mode === "create") editing.addItem.mutate({ trackId: target.trackId, input }, done);
  };

  return (
    <div
      className="grid gap-4"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Type className="size-4 text-brand" /> {editingItem ? "Editar texto" : "Nuevo texto"}
        </DialogTitle>
        <DialogDescription>Formato, posición y animación. Arrastra el texto sobre el cuadro para moverlo.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-2">
          <TextStage
            text={text}
            style={style}
            local={shownAt}
            duration={duration}
            width={width}
            height={height}
            background={sceneAt(scenes, startS ?? 0)}
            onMove={(x, y) => set({ x, y })}
          />
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pausar la animación" : "Ver la animación"}>
              {playing ? <Pause /> : <Play />} {playing ? "Pausar" : "Ver animación"}
            </Button>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Inicio
              <Input aria-label="Inicio" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-24 font-mono" />
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Duración
              <Input aria-label="Duración en segundos" value={length} onChange={(e) => setLength(e.target.value)} className="h-8 w-20 font-mono" />
              s
            </label>
            {timeError && <span className="text-danger">{timeError}</span>}
          </div>
        </div>

        <div className="grid min-w-0 content-start gap-3">
          <div role="tablist" aria-label="Opciones del texto" className="grid grid-cols-4 rounded-md border p-0.5 text-[12px]">
            {(
              [
                ["text", "Texto"],
                ["style", "Estilo"],
                ["edge", "Borde y sombra"],
                ["animation", "Animación"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn("rounded px-1 py-1", tab === id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[56vh] overflow-y-auto pr-1">
            {tab === "text" && (
              <div className="grid gap-3">
                <Textarea aria-label="Texto" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu texto" />
                <div className="grid gap-1.5">
                  <span className="text-[12px] text-muted-foreground">Estilos rápidos</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TEXT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        title={p.label}
                        aria-label={`Estilo ${p.label}`}
                        onClick={() => set({ ...DEFAULT_TEXT_OVERLAY, ...p.style, x: p.style.x ?? style.x, y: p.style.y ?? style.y, align: p.style.align ?? style.align })}
                        className="flex h-14 items-center justify-center overflow-hidden rounded-md border bg-[#202020] px-1 hover:border-brand"
                      >
                        <PresetSample style={{ ...DEFAULT_TEXT_OVERLAY, ...p.style }} text={p.sample} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-[12px] text-muted-foreground">Posición</span>
                  <div className="grid w-fit grid-cols-3 gap-1" role="radiogroup" aria-label="Posición">
                    {POSITIONS.map((p) => {
                      const on = Math.abs(style.x - p.x) < 0.01 && Math.abs(style.y - p.y) < 0.01;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={p.label}
                          title={p.label}
                          onClick={() => set({ x: p.x, y: p.y, align: p.align })}
                          className={cn("size-8 rounded border", on ? "border-brand bg-brand/30" : "hover:bg-panel-2")}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {tab === "style" && (
              <div className="grid gap-3 text-[12px]">
                <label className="grid gap-1 text-muted-foreground">
                  Fuente
                  <Select value={style.font} onValueChange={(v) => set({ font: v as TextOverlayStyle["font"] })}>
                    <SelectTrigger aria-label="Fuente" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_FONTS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          <span style={{ fontFamily: f.family }}>{f.id}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <RangeRow label="Tamaño" value={style.size} min={12} max={300} onChange={(size) => set({ size })} suffix=" px" />
                <ColorRow label="Color" value={style.color} onChange={(color) => set({ color })} />
                <div className="flex flex-wrap gap-1.5" aria-label="Formato">
                  <Toggle on={style.bold} label="Negrita" disabled={style.font === "Montserrat"} onClick={() => set({ bold: !style.bold })}>
                    <Bold />
                  </Toggle>
                  <Toggle on={style.italic} label="Cursiva" onClick={() => set({ italic: !style.italic })}>
                    <Italic />
                  </Toggle>
                  <Toggle on={style.underline} label="Subrayado" onClick={() => set({ underline: !style.underline })}>
                    <Underline />
                  </Toggle>
                  <Toggle on={style.uppercase} label="Mayúsculas" onClick={() => set({ uppercase: !style.uppercase })}>
                    <CaseUpper />
                  </Toggle>
                  <span className="mx-1 w-px bg-border" />
                  {(
                    [
                      ["left", AlignLeft, "Alinear a la izquierda"],
                      ["center", AlignCenter, "Centrar"],
                      ["right", AlignRight, "Alinear a la derecha"],
                    ] as const
                  ).map(([id, Icon, label]) => (
                    <Toggle key={id} on={style.align === id} label={label} onClick={() => set({ align: id })}>
                      <Icon />
                    </Toggle>
                  ))}
                </div>
                <RangeRow label="Espacio entre letras" value={style.letter_spacing} min={-10} max={40} onChange={(letter_spacing) => set({ letter_spacing })} suffix=" px" />
                <RangeRow label="Ancho máximo" value={style.max_width} min={20} max={100} onChange={(max_width) => set({ max_width })} suffix=" %" />
                <RangeRow label="Opacidad" value={style.opacity} min={0} max={100} onChange={(opacity) => set({ opacity })} suffix=" %" />
                <RangeRow label="Rotación" value={style.rotation} min={-180} max={180} onChange={(rotation) => set({ rotation })} suffix="°" />
              </div>
            )}
            {tab === "edge" && (
              <div className="grid gap-4 text-[12px]">
                <Group title="Borde" on={style.outline && !style.background} disabled={style.background} onToggle={(outline) => set({ outline })}>
                  <ColorRow label="Color del borde" value={style.outline_color} onChange={(outline_color) => set({ outline_color })} />
                  <RangeRow label="Grosor" value={style.outline_width} min={0} max={30} onChange={(outline_width) => set({ outline_width })} suffix=" px" />
                </Group>
                <Group title="Sombra" on={style.shadow && !style.background} disabled={style.background} onToggle={(shadow) => set({ shadow })}>
                  <ColorRow label="Color de la sombra" value={style.shadow_color} onChange={(shadow_color) => set({ shadow_color })} />
                  <RangeRow label="Opacidad" value={style.shadow_opacity} min={0} max={100} onChange={(shadow_opacity) => set({ shadow_opacity })} suffix=" %" />
                  <RangeRow label="Distancia" value={style.shadow_distance} min={0} max={40} onChange={(shadow_distance) => set({ shadow_distance })} suffix=" px" />
                  <RangeRow label="Desenfoque" value={style.shadow_blur} min={0} max={30} onChange={(shadow_blur) => set({ shadow_blur })} suffix=" px" />
                </Group>
                <Group title="Fondo (caja)" on={style.background} onToggle={(background) => set({ background })}>
                  <ColorRow label="Color del fondo" value={style.background_color} onChange={(background_color) => set({ background_color })} />
                  <RangeRow label="Opacidad" value={style.background_opacity} min={0} max={100} onChange={(background_opacity) => set({ background_opacity })} suffix=" %" />
                  <RangeRow label="Margen" value={style.background_padding} min={0} max={80} onChange={(background_padding) => set({ background_padding })} suffix=" px" />
                </Group>
                {style.background && <p className="text-subtle">Con fondo, el borde y la sombra no se dibujan (como en el render).</p>}
              </div>
            )}
            {tab === "animation" && (
              <div className="grid gap-3 text-[12px]">
                <ChipGroup label="Entrada" options={ANIMATIONS_IN} value={style.animation_in} onChange={(animation_in) => set({ animation_in })} />
                <ChipGroup label="Salida" options={ANIMATIONS_OUT} value={style.animation_out} onChange={(animation_out) => set({ animation_out })} />
                <RangeRow
                  label="Duración de la animación"
                  value={style.animation_s}
                  min={0.1}
                  max={2}
                  step={0.1}
                  onChange={(animation_s) => set({ animation_s })}
                  suffix=" s"
                  digits={1}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <div className="flex gap-1">
          {editingItem && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!editable}
                onClick={() => editing.deleteItem.mutate(editingItem.id, { onSuccess: () => onClose() })}
              >
                <Trash2 /> Eliminar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!editable}
                onClick={() => editing.duplicateItem.mutate(editingItem.id, { onSuccess: () => onClose() })}
              >
                <Copy /> Duplicar
              </Button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          <Button disabled={!valid || busy || !editable} onClick={save}>
            {busy && <LoaderCircle className="animate-spin" />}
            {editingItem ? "Guardar" : "Agregar texto"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

/** Reloj en bucle para la animación: entrada, una pausa y salida. */
function useLocalLoop(duration: number, running: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const t0 = performance.now();
    const period = duration + 0.5;
    const tick = (now: number) => {
      setT(Math.min(((now - t0) / 1000) % period, duration - 0.001));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, running]);
  return t;
}

export function sceneAt(scenes: TimelineScene[], t: number): TimelineScene | undefined {
  let found: TimelineScene | undefined;
  for (const s of scenes) if (t >= s.start_s - 1e-6) found = s;
  return found ?? scenes[0];
}

/** El cuadro del video con el texto encima; el texto se arrastra para moverlo. */
function TextStage({
  text,
  style,
  local,
  duration,
  width,
  height,
  background,
  onMove,
}: {
  text: string;
  style: TextOverlayStyle;
  local: number;
  duration: number;
  width: number;
  height: number;
  background: TimelineScene | undefined;
  onMove: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const drag = useRef<{ x0: number; y0: number; sx: number; sy: number } | null>(null);
  const [guides, setGuides] = useState({ v: false, h: false });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setBoxWidth(el.getBoundingClientRect().width);
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const scale = boxWidth / width || 0.3;
  const thumb = coreUrl(background?.thumb_url);
  const portrait = height > width;

  return (
    <div className="flex justify-center rounded-md bg-black/50 p-2">
      <div
        ref={box}
        data-testid="text-stage"
        className="relative cursor-move touch-none overflow-hidden rounded bg-black select-none"
        style={{ aspectRatio: `${width} / ${height}`, width: portrait ? undefined : "100%", height: portrait ? "56vh" : undefined, maxWidth: "100%" }}
        onPointerDown={(e) => {
          drag.current = { x0: e.clientX, y0: e.clientY, sx: style.x, sy: style.y };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const rect = box.current?.getBoundingClientRect();
          if (!d || !rect?.width) return;
          let x = Math.min(Math.max(d.sx + (e.clientX - d.x0) / rect.width, 0), 1);
          let y = Math.min(Math.max(d.sy + (e.clientY - d.y0) / rect.height, 0), 1);
          const v = style.align === "center" && Math.abs(x - 0.5) < SNAP;
          const h = Math.abs(y - 0.5) < SNAP;
          if (v) x = 0.5;
          if (h) y = 0.5;
          setGuides({ v, h });
          onMove(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
        }}
        onPointerUp={() => {
          drag.current = null;
          setGuides({ v: false, h: false });
        }}
      >
        {thumb && <img src={thumb} alt="" draggable={false} className="absolute inset-0 size-full object-cover opacity-80" />}
        {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-brand" />}
        {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-brand" />}
        {text.trim() && (
          <OverlayTextView text={text} style={style} local={local} duration={duration} width={width} height={height} scale={scale} testId="text-stage-text" />
        )}
      </div>
    </div>
  );
}

function PresetSample({ style, text }: { style: TextOverlayStyle; text: string }) {
  const scale = 26 / style.size;
  return (
    <span
      className="truncate"
      style={{
        fontFamily: fontFamily(style.font),
        fontWeight: style.font === "Montserrat" ? 800 : style.bold ? 700 : 400,
        fontStyle: style.italic ? "italic" : undefined,
        fontSize: 18,
        color: style.color,
        letterSpacing: style.letter_spacing * scale,
        textTransform: style.uppercase ? "uppercase" : undefined,
        background: style.background ? `${style.background_color}${Math.round((style.background_opacity / 100) * 255).toString(16).padStart(2, "0")}` : undefined,
        padding: style.background ? "0 4px" : undefined,
        WebkitTextStroke: style.outline && !style.background ? `${Math.max(1, style.outline_width * scale * 2)}px ${style.outline_color}` : undefined,
        paintOrder: "stroke fill",
        textShadow: style.shadow && !style.background ? `0 0 ${Math.max(2, style.shadow_blur * scale)}px ${style.shadow_color}` : undefined,
      }}
    >
      {text}
    </span>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1 text-[12px] text-muted-foreground">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-foreground">
          {value.toFixed(digits)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1 text-[12px] text-muted-foreground">
      {label}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border bg-transparent"
        />
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label}: ${c}`}
            onClick={() => onChange(c)}
            className={cn("size-5 rounded-full border", value.toUpperCase() === c && "ring-2 ring-brand ring-offset-1 ring-offset-panel")}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function Toggle({
  on,
  label,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={disabled ? `${label}: la fuente ya es gruesa` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded border disabled:opacity-40 [&_svg]:size-4",
        on ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}

function Group({
  title,
  on,
  disabled,
  onToggle,
  children,
}: {
  title: string;
  on: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-2 rounded-md border p-2.5", disabled && "opacity-50")}>
      <label className="flex items-center justify-between font-medium text-foreground">
        {title}
        <Switch aria-label={title} checked={on} disabled={disabled} onCheckedChange={onToggle} />
      </label>
      {on && children}
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Animación de ${label.toLowerCase()}`}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-full border px-2.5 py-1",
              value === o.id ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
