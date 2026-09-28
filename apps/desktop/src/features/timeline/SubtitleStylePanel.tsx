import { Captions } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SubtitleStyle } from "@/lib/api";
import { SUBTITLE_PRESETS, subtitleTextCss } from "./previewMeta";
import { cn } from "@/lib/utils";

const HIGHLIGHTS = ["#FFD400", "#22E36B", "#FF7A1A", "#33D6FF", "#FF4FA3"];
const TEXT_COLORS = ["#FFFFFF", "#FFD400", "#F2F2F2"];
const SAMPLE = ["Se", "lanzó", "del", "avión"];
const FONTS: SubtitleStyle["font"][] = ["Arial", "Montserrat", "Impact", "Verdana", "Segoe UI"];

/** Estilo de los subtítulos quemados, con vista previa animada (palabra que se dice resaltada). */
export function SubtitleStylePanel({
  style,
  onChange,
  portrait,
  disabled,
  compact,
}: {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  portrait: boolean;
  disabled?: boolean;
  /** En la columna lateral: sin miniatura (la vista previa grande ya lo muestra) y en una columna. */
  compact?: boolean;
}) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!style.highlight) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % SAMPLE.length), 450);
    return () => window.clearInterval(id);
  }, [style.highlight]);

  const perLine = style.words_per_line || (portrait ? 3 : 6);
  const words = SAMPLE.slice(0, Math.min(perLine, SAMPLE.length));
  const size = { small: 15, medium: 19, large: 24 }[style.size];

  return (
    <div
      className={cn("grid gap-4", compact ? "grid-cols-1" : "grid-cols-[auto_minmax(0,1fr)] rounded-md border p-3")}
      aria-label="Estilo de subtítulos"
    >
      {/* Vista previa */}
      {!compact && (
      <div
        data-testid="subtitle-preview"
        className={cn(
          "relative flex shrink-0 justify-center overflow-hidden rounded bg-[linear-gradient(160deg,#3b4a5c,#1b2230)]",
          portrait ? "h-52 w-[117px]" : "h-[117px] w-52",
          style.position === "middle" ? "items-center" : "items-end pb-[22%]",
        )}
      >
        <span
          className={cn("px-2 text-center leading-tight font-bold", style.background && "rounded bg-black/60 py-0.5")}
          style={{ ...subtitleTextCss(style, 0.1), fontSize: size * (portrait ? 0.62 : 0.55) }}
        >
          {words.map((w, i) => (
            <span key={w} style={style.highlight && i === active % words.length ? { color: style.highlight_color } : undefined}>
              {(style.uppercase ? w.toUpperCase() : w) + (i < words.length - 1 ? " " : "")}
            </span>
          ))}
        </span>
      </div>
      )}

      <div className="grid content-start gap-3 text-[12px]">
        <div className="grid gap-1 text-muted-foreground">
          Estilos rápidos
          <div className="flex flex-wrap gap-1.5">
            {SUBTITLE_PRESETS.map((p) => {
              const on = Object.entries(p.style).every(([k, v]) => style[k as keyof SubtitleStyle] === v);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onChange(p.style)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[12px]",
                    on ? "border-brand bg-active text-active-foreground" : "hover:bg-panel-2",
                  )}
                  style={p.id === "reel" ? { fontFamily: "Montserrat", fontStyle: "italic", fontWeight: 800 } : undefined}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        {!compact && (
          <div className="flex items-center gap-2 font-medium">
            <Captions className="size-4 text-brand" /> Estilo de los subtítulos
          </div>
        )}
        <div className={cn("grid gap-x-4 gap-y-2.5", compact ? "grid-cols-1" : "grid-cols-2")}>
          <Toggle label="Mayúsculas" checked={style.uppercase} disabled={disabled} onChange={(v) => onChange({ uppercase: v })} />
          <Toggle
            label="Resaltar la palabra que se dice"
            checked={style.highlight}
            disabled={disabled}
            onChange={(v) => onChange({ highlight: v })}
          />
          <Toggle label="Fondo detrás del texto" checked={style.background} disabled={disabled} onChange={(v) => onChange({ background: v })} />
          <Toggle label="Cursiva" checked={!!style.italic} disabled={disabled} onChange={(v) => onChange({ italic: v })} />
          <label className="flex items-center justify-between gap-2 text-muted-foreground">
            Palabras por frase
            <Select
              value={String(style.words_per_line)}
              onValueChange={(v) => onChange({ words_per_line: Number(v) })}
              disabled={disabled}
            >
              <SelectTrigger size="sm" className="w-28" aria-label="Palabras por frase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Auto ({portrait ? 3 : 6})</SelectItem>
                {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-3")}>
          <label className={cn("grid gap-1 text-muted-foreground", compact && "col-span-2")}>
            Fuente
            <Select value={style.font} onValueChange={(v) => onChange({ font: v as SubtitleStyle["font"] })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-full" aria-label="Fuente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f}>
                    <span style={{ fontFamily: f }}>{f}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Segmented
            label="Tamaño"
            value={style.size}
            disabled={disabled}
            options={[
              ["small", "S"],
              ["medium", "M"],
              ["large", "L"],
            ]}
            onChange={(v) => onChange({ size: v as SubtitleStyle["size"] })}
          />
          <Segmented
            label="Contorno"
            value={style.edge ?? "outline"}
            disabled={disabled || style.background}
            options={[
              ["outline", "Borde"],
              ["shadow", "Sombra"],
              ["both", "Ambos"],
            ]}
            onChange={(v) => onChange({ edge: v as SubtitleStyle["edge"] })}
          />
          <Segmented
            label="Animación"
            value={style.animation ?? "none"}
            disabled={disabled}
            options={[
              ["none", "Ninguna"],
              ["pop", "Pop"],
            ]}
            onChange={(v) => onChange({ animation: v as SubtitleStyle["animation"] })}
          />
          <Segmented
            label="Posición"
            value={style.position}
            disabled={disabled}
            options={[
              ["bottom", "Abajo"],
              ["middle", "Centro"],
            ]}
            onChange={(v) => onChange({ position: v as SubtitleStyle["position"] })}
          />
        </div>

        <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
          <Swatches
            label="Color del texto"
            colors={TEXT_COLORS}
            value={style.text_color}
            disabled={disabled}
            onChange={(c) => onChange({ text_color: c })}
          />
          <Swatches
            label="Color del resaltado"
            colors={HIGHLIGHTS}
            value={style.highlight_color}
            disabled={disabled || !style.highlight}
            onChange={(c) => onChange({ highlight_color: c })}
          />
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-muted-foreground">
      {label}
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function Segmented({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1 text-muted-foreground">
      {label}
      <div role="radiogroup" aria-label={label} className="flex rounded-md border p-0.5">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              "h-6 flex-1 rounded px-2 text-[12px]",
              value === id ? "bg-active text-active-foreground" : "hover:bg-panel-2",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Swatches({
  label,
  colors,
  value,
  disabled,
  onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  disabled?: boolean;
  onChange: (c: string) => void;
}) {
  return (
    <div className={cn("grid gap-1 text-muted-foreground", disabled && "opacity-50")}>
      {label}
      <div className="flex items-center gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={value.toUpperCase() === c}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cn(
              "size-6 rounded-full border-2",
              value.toUpperCase() === c ? "border-brand ring-2 ring-brand/40" : "border-white/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <label className="relative size-6 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-white/40" title="Otro color">
          <input
            type="color"
            aria-label={`${label}: otro color`}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}
