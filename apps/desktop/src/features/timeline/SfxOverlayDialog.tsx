import { Check, Copy, LoaderCircle, Pause, Play, Search, Trash2, Upload, Volume2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseClock } from "@/features/media/dropUtils";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import { UploadSoundDialog } from "@/features/sounds/UploadSoundDialog";
import { formatSeconds, usePreview } from "@/features/sounds/usePreview";
import type { OverlayEditing } from "@/hooks/useOverlays";
import { useSounds } from "@/hooks/useSounds";
import { coreUrl, type OverlayItem, type Sound, type SoundKind } from "@/lib/api";
import { cn } from "@/lib/utils";

export type SfxTarget = { mode: "create"; trackId: number; start_s: number } | { mode: "edit"; item: OverlayItem };

/** Elegir un efecto de sonido (o un tema) para una pista propia, con volumen y fundidos. */
export function SfxOverlayDialog({
  target,
  totalS,
  channelId,
  editing,
  editable,
  onClose,
}: {
  target: SfxTarget | null;
  totalS: number;
  channelId?: number | null;
  editing: OverlayEditing;
  editable: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-3xl" aria-describedby={undefined}>
        {target && (
          <SfxEditor
            key={target.mode === "edit" ? `e${target.item.id}` : `c${target.trackId}-${target.start_s}`}
            target={target}
            totalS={totalS}
            channelId={channelId}
            editing={editing}
            editable={editable}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SfxEditor({
  target,
  totalS,
  channelId,
  editing,
  editable,
  onClose,
}: {
  target: SfxTarget;
  totalS: number;
  channelId?: number | null;
  editing: OverlayEditing;
  editable: boolean;
  onClose: () => void;
}) {
  const item = target.mode === "edit" ? target.item : null;
  const [kind, setKind] = useState<SoundKind>("sfx");
  const [q, setQ] = useState("");
  const { data: sounds = [], isLoading } = useSounds({ kind, q });
  const [chosen, setChosen] = useState<{ id: number; title: string; duration: number | null } | null>(
    item?.sound_id ? { id: item.sound_id, title: item.sound_title ?? "", duration: item.sound_duration_s } : null,
  );
  const [start, setStart] = useState(formatSceneTime(item?.start_s ?? (target.mode === "create" ? target.start_s : 0)));
  const [length, setLength] = useState<string>(item ? String(item.duration_s) : "");
  const [volume, setVolume] = useState(item?.volume ?? 100);
  const [fadeIn, setFadeIn] = useState(item?.fade_in_s ?? 0);
  const [fadeOut, setFadeOut] = useState(item?.fade_out_s ?? 0);
  const [uploading, setUploading] = useState(false);
  const preview = usePreview();

  const startS = parseClock(start);
  const full = chosen?.duration ?? null;
  const durationS = length.trim() ? Number(length.replace(",", ".")) : (full ?? 1);
  const error =
    !chosen
      ? "Elige un sonido de la lista"
      : startS === null || Number.isNaN(startS)
        ? "Inicio: usa minutos:segundos, por ejemplo 0:12.5"
        : startS >= totalS
          ? `El video dura ${formatSceneTime(totalS)}`
          : !(durationS >= 0.2)
            ? "La duración debe ser de al menos 0,2 s"
            : null;
  const busy = editing.addItem.isPending || editing.updateItem.isPending;

  const pick = (s: Sound) => {
    setChosen({ id: s.id, title: s.title, duration: s.duration_s });
    setLength(s.duration_s ? String(Math.round(s.duration_s * 100) / 100) : "");
  };

  const save = () => {
    if (error || !chosen || !editable) return;
    const input = {
      sound_id: chosen.id,
      start_s: startS ?? 0,
      duration_s: full ? Math.min(durationS, full) : durationS,
      volume,
      fade_in_s: fadeIn,
      fade_out_s: fadeOut,
    };
    if (item) editing.updateItem.mutate({ id: item.id, input }, { onSuccess: onClose });
    else if (target.mode === "create") editing.addItem.mutate({ trackId: target.trackId, input }, { onSuccess: onClose });
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Volume2 className="size-4 text-brand" /> {item ? "Editar efecto de sonido" : "Agregar efecto de sonido"}
        </DialogTitle>
        <DialogDescription>De la biblioteca de sonidos. Suena desde el inicio elegido; no se repite.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Tipo de sonido" className="flex rounded-md border p-0.5 text-[12px]">
          {(
            [
              ["sfx", "Efectos"],
              ["music", "Música"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kind === id}
              onClick={() => setKind(id)}
              className={cn("rounded px-3 py-1", kind === id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2")}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            aria-label="Buscar sonido"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="whoosh, impacto, latido…"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
          <Upload /> Subir audio
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border" role="radiogroup" aria-label="Sonidos">
        {isLoading && <p className="p-3 text-[12px] text-muted-foreground">Cargando…</p>}
        {!isLoading && sounds.length === 0 && (
          <p className="p-3 text-[12px] text-muted-foreground">
            No hay sonidos{q ? " con esa búsqueda" : ""}. Súbelos o búscalos en Freesound desde «SFX y música».
          </p>
        )}
        {sounds.map((s) => (
          <div
            key={s.id}
            className={cn("flex items-center gap-2 border-b px-2 py-1.5 text-[13px] last:border-b-0", chosen?.id === s.id && "bg-active/60")}
          >
            <Button size="icon-xs" variant="outline" aria-label={`Escuchar ${s.title}`} onClick={() => preview.toggle(`s${s.id}`, coreUrl(s.file_url)!)}>
              {preview.playing === `s${s.id}` ? <Pause /> : <Play />}
            </Button>
            <button type="button" role="radio" aria-checked={chosen?.id === s.id} onClick={() => pick(s)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              {s.tags.slice(0, 3).map((t) => (
                <span key={t} className="hidden rounded bg-panel-2 px-1.5 text-[10px] text-muted-foreground sm:inline">
                  {t}
                </span>
              ))}
              <span className="w-12 shrink-0 text-right font-mono text-[11px] text-subtle">{formatSeconds(s.duration_s)}</span>
              {chosen?.id === s.id && <Check className="size-4 shrink-0 text-brand" />}
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 text-[12px] sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <span className="text-muted-foreground">
            Elegido: <span className="font-medium text-foreground">{chosen?.title || "—"}</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Inicio
              <Input aria-label="Inicio" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-24 font-mono" />
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Duración
              <Input
                aria-label="Duración en segundos"
                value={length}
                placeholder={full ? String(full) : ""}
                onChange={(e) => setLength(e.target.value)}
                className="h-8 w-20 font-mono"
              />
              s
            </label>
          </div>
          {full && durationS > full + 0.01 && <span className="text-subtle">El sonido dura {formatSeconds(full)}: no se repite.</span>}
          {error && chosen && <span className="text-danger">{error}</span>}
        </div>
        <div className="grid gap-2">
          <Slider label="Volumen" value={volume} min={0} max={200} step={5} suffix=" %" onChange={setVolume} />
          <Slider label="Entrada suave" value={fadeIn} min={0} max={3} step={0.1} suffix=" s" digits={1} onChange={setFadeIn} />
          <Slider label="Salida suave" value={fadeOut} min={0} max={3} step={0.1} suffix=" s" digits={1} onChange={setFadeOut} />
        </div>
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex gap-1">
          {item && (
            <>
              <Button variant="ghost" size="sm" disabled={!editable} onClick={() => editing.deleteItem.mutate(item.id, { onSuccess: onClose })}>
                <Trash2 /> Eliminar
              </Button>
              <Button variant="ghost" size="sm" disabled={!editable} onClick={() => editing.duplicateItem.mutate(item.id, { onSuccess: onClose })}>
                <Copy /> Duplicar
              </Button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!!error || busy || !editable} onClick={save}>
            {busy && <LoaderCircle className="animate-spin" />}
            {item ? "Guardar" : "Agregar sonido"}
          </Button>
        </div>
      </DialogFooter>
      <UploadSoundDialog
        open={uploading}
        onClose={() => setUploading(false)}
        kind={kind}
        channelId={channelId}
        onAdded={(added) => {
          setUploading(false);
          if (added[0]) pick(added[0]);
        }}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1 text-muted-foreground">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-foreground">
          {value.toFixed(digits)}
          {suffix}
        </span>
      </span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </label>
  );
}
