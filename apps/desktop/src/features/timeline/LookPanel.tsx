import { FileUp } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useImportLut } from "@/hooks/useRender";
import type { VideoLook } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LOOK_PRESETS, NEUTRAL_LOOK, presetLook } from "./previewMeta";

const NO_LUT = "__none__";

type Slider = { key: keyof VideoLook; label: string; min: number; max: number; hint?: string; format?: (v: number) => string };

const COLOR: Slider[] = [
  { key: "saturation", label: "Saturación", min: 0, max: 150, hint: "30–50: look desaturado", format: (v) => `${v} %` },
  { key: "contrast", label: "Contraste", min: -50, max: 50 },
  { key: "brightness", label: "Brillo", min: -50, max: 50 },
  { key: "blacks", label: "Negros profundos", min: 0, max: 100, hint: "Baja el «lift»" },
  {
    key: "temperature",
    label: "Tinte",
    min: -100,
    max: 100,
    hint: "Frío: azul/verde en sombras · Cálido: naranja",
    format: (v) => (v === 0 ? "neutro" : v < 0 ? `frío ${-v}` : `cálido ${v}`),
  },
];
const TEXTURE: Slider[] = [
  { key: "vignette", label: "Viñeta", min: 0, max: 100, hint: "Oscurece los bordes" },
  { key: "grain", label: "Grano de película", min: 0, max: 100, hint: "Iguala la textura de fotos limpias y videos" },
  { key: "soften_photos", label: "Suavizar fotos", min: 0, max: 100, hint: "Que las fotos no se vean más nítidas que los videos" },
];

export const lookSummary = (look: VideoLook) => {
  const preset = LOOK_PRESETS.find((p) => p.id === look.preset);
  const same = preset && JSON.stringify(presetLook(preset.id)) === JSON.stringify({ ...look, lut: null, lut_strength: 100 });
  const name = preset ? (same ? preset.label : `${preset.label} (ajustado)`) : "Personalizado";
  return look.lut ? `${name} · LUT` : name;
};

function SliderRow({ s, look, onChange, disabled }: { s: Slider; look: VideoLook; onChange: (patch: Partial<VideoLook>) => void; disabled?: boolean }) {
  const value = look[s.key] as number;
  const neutral = NEUTRAL_LOOK[s.key] as number;
  return (
    <label className="grid gap-0.5" title={s.hint}>
      <span className="flex justify-between text-muted-foreground">
        {s.label}
        <span className={cn("font-mono", value !== neutral ? "text-foreground" : "text-subtle")}>{s.format ? s.format(value) : value}</span>
      </span>
      <input
        type="range"
        aria-label={s.label}
        min={s.min}
        max={s.max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
        onDoubleClick={() => onChange({ [s.key]: neutral })}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}

/**
 * Look de todo el video, como un clip de ajuste encima de la línea de tiempo: el mismo
 * tratamiento para videos y fotos. El texto en pantalla y los subtítulos quedan fuera.
 */
export function LookPanel({
  look,
  onChange,
  luts,
  projectId,
  disabled,
}: {
  look: VideoLook;
  onChange: (patch: Partial<VideoLook>) => void;
  luts: string[];
  projectId: number;
  disabled?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const importLut = useImportLut(projectId);
  // Tocar un control deja el estilo rápido como punto de partida («ajustado»).
  const set = (patch: Partial<VideoLook>) => onChange(patch);

  return (
    <div className="grid gap-3 text-[12px]" aria-label="Look del video">
      <p className="text-[11px] text-subtle">Se aplica igual a videos y fotos. El texto en pantalla y los subtítulos quedan por fuera.</p>
      <div className="grid gap-1 text-muted-foreground">
        Estilos rápidos
        <div role="radiogroup" aria-label="Estilo del look" className="flex flex-wrap gap-1.5">
          {LOOK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={look.preset === p.id}
              title={p.hint}
              disabled={disabled}
              onClick={() => onChange({ ...presetLook(p.id), lut: look.lut, lut_strength: look.lut_strength })}
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors disabled:opacity-50",
                look.preset === p.id ? "border-brand bg-active text-active-foreground" : "hover:bg-panel-2",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <span className="font-medium">Color</span>
        {COLOR.map((s) => (
          <SliderRow key={s.key} s={s} look={look} onChange={set} disabled={disabled} />
        ))}
      </div>

      <div className="grid gap-2">
        <span className="font-medium">LUT</span>
        <div className="flex gap-2">
          <Select value={look.lut ?? NO_LUT} disabled={disabled} onValueChange={(v) => set({ lut: v === NO_LUT ? null : v })}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="LUT">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LUT}>Sin LUT</SelectItem>
              {luts.map((l) => (
                <SelectItem key={l} value={l}>
                  {l.replace(/\.cube$/i, "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={disabled || importLut.isPending} onClick={() => file.current?.click()}>
            <FileUp /> Importar .cube
          </Button>
          <input
            ref={file}
            type="file"
            accept=".cube"
            hidden
            aria-label="Archivo LUT"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              importLut.mutate(f, {
                onSuccess: (r) => {
                  if (r.imported) set({ lut: r.imported });
                  toast.success(`LUT importado: ${r.imported ?? f.name}`);
                },
                onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo importar el LUT"),
              });
            }}
          />
        </div>
        {look.lut && (
          <>
            <SliderRow s={{ key: "lut_strength", label: "Intensidad del LUT", min: 0, max: 100, format: (v) => `${v} %` }} look={look} onChange={set} disabled={disabled} />
            <p className="text-[11px] text-subtle">El LUT se ve en el render (la vista previa muestra el resto del look).</p>
          </>
        )}
      </div>

      <div className="grid gap-2">
        <span className="font-medium">Textura</span>
        {TEXTURE.map((s) => (
          <SliderRow key={s.key} s={s} look={look} onChange={set} disabled={disabled} />
        ))}
      </div>

      <label className="flex items-center justify-between gap-2">
        <span title="Las fotos sin efecto llevan un zoom lento, para que parezcan video">Zoom lento en las fotos sin efecto</span>
        <Switch aria-label="Zoom lento en fotos" checked={look.zoom_photos} disabled={disabled} onCheckedChange={(v) => set({ zoom_photos: v })} />
      </label>
      <p className="text-[11px] text-subtle">Todo llena el cuadro sin barras negras: cada medio se escala y recorta (o se encuadra con fondo desenfocado en «Encuadre»). Doble clic en un control: valor neutro.</p>
    </div>
  );
}
