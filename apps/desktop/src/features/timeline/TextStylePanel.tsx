import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { TextStyle } from "@/lib/api";
import { cn } from "@/lib/utils";

export const TEXT_ANIMATIONS: { id: TextStyle["animation"]; label: string; hint: string }[] = [
  { id: "pop", label: "Pop", hint: "Crece con un pequeño rebote" },
  { id: "fade", label: "Aparecer", hint: "Fundido suave" },
  { id: "slide", label: "Deslizar", hint: "Sube desde abajo" },
  { id: "typewriter", label: "Máquina de escribir", hint: "Letra a letra" },
  { id: "none", label: "Sin efecto", hint: "Aparece de golpe" },
];

const FONTS: TextStyle["font"][] = ["Montserrat", "Arial", "Impact", "Verdana", "Segoe UI"];
const COLORS = ["#FFFFFF", "#FFD400", "#FF4B4B", "#33D6FF"];
const SIZES: { id: TextStyle["size"]; label: string }[] = [
  { id: "small", label: "Pequeño" },
  { id: "medium", label: "Mediano" },
  { id: "large", label: "Grande" },
];

export const textStyleSummary = (style: TextStyle) =>
  `${TEXT_ANIMATIONS.find((a) => a.id === style.animation)?.label ?? ""} · ${style.font}${style.box ? " · con fondo" : ""}`;

/** Estilo del texto en pantalla de las escenas (títulos, fechas, datos); se ve en la vista previa. */
export function TextStylePanel({
  style,
  onChange,
  disabled,
}: {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 text-[12px]" aria-label="Estilo del texto en pantalla">
      <div className="grid gap-1 text-muted-foreground">
        Animación de entrada
        <div role="radiogroup" aria-label="Animación del texto" className="flex flex-wrap gap-1.5">
          {TEXT_ANIMATIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={style.animation === a.id}
              title={a.hint}
              disabled={disabled}
              onClick={() => onChange({ animation: a.id })}
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors disabled:opacity-50",
                style.animation === a.id ? "border-brand bg-active text-active-foreground" : "hover:bg-panel-2",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-muted-foreground">
          Fuente
          <Select value={style.font} disabled={disabled} onValueChange={(v) => onChange({ font: v as TextStyle["font"] })}>
            <SelectTrigger className="w-full" aria-label="Fuente del texto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONTS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-muted-foreground">
          Tamaño
          <Select value={style.size} disabled={disabled} onValueChange={(v) => onChange({ size: v as TextStyle["size"] })}>
            <SelectTrigger className="w-full" aria-label="Tamaño del texto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground">
        Color
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={style.text_color === c}
            disabled={disabled}
            onClick={() => onChange({ text_color: c })}
            className={cn("size-5 rounded-full border", style.text_color === c && "ring-2 ring-brand ring-offset-1 ring-offset-background")}
            style={{ background: c }}
          />
        ))}
      </div>

      <label className="flex items-center justify-between gap-2">
        <span>Mayúsculas</span>
        <Switch aria-label="Texto en mayúsculas" checked={style.uppercase} disabled={disabled} onCheckedChange={(v) => onChange({ uppercase: v })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Fondo oscuro detrás del texto</span>
        <Switch aria-label="Fondo del texto" checked={style.box} disabled={disabled} onCheckedChange={(v) => onChange({ box: v })} />
      </label>
    </div>
  );
}
