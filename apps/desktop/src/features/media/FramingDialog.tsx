import { LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { formatSceneTime } from "@/features/scenes/sceneMeta";
import { useFraming, useSaveFraming } from "@/hooks/useFraming";
import { coreUrl, type Crop, type FramingMode, type FramingState } from "@/lib/api";
import { cn } from "@/lib/utils";
import { parseClock } from "./dropUtils";
import { cropCenter, cropScale, moveCrop, scaledCrop, trimError } from "./framingMeta";

const MODES: { id: FramingMode; label: string; hint: string }[] = [
  { id: "none", label: "Tal cual", hint: "El editor decide cómo encajarlo" },
  { id: "crop", label: "Recortar", hint: "Eliges el área visible" },
  { id: "blur", label: "Fondo desenfocado", hint: "Se ve entero, sobre un fondo borroso" },
];

export interface FramingTarget {
  sceneId: number;
  assetId: number;
  fileUrl: string;
}

/** Encuadre (16:9 o 9:16) y tramo del medio aprobado (sección 5.6). */
export function FramingDialog({
  projectId,
  target,
  onClose,
}: {
  projectId: number;
  target: FramingTarget | null;
  onClose: () => void;
}) {
  const { data: state } = useFraming(target?.sceneId ?? 0, target?.assetId ?? null);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-3xl">
        {target && state && state.asset_id === target.assetId && (
          <FramingForm projectId={projectId} state={state} fileUrl={target.fileUrl} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FramingForm({
  projectId,
  state,
  fileUrl,
  onClose,
}: {
  projectId: number;
  state: FramingState;
  fileUrl: string;
  onClose: () => void;
}) {
  const save = useSaveFraming(projectId);
  const max = state.suggested_crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const [mode, setMode] = useState<FramingMode>(state.mode);
  const [crop, setCrop] = useState<Crop>(state.crop ?? max);
  const [from, setFrom] = useState(state.trim_in_s != null ? formatSceneTime(state.trim_in_s) : "");
  const [to, setTo] = useState(state.trim_out_s != null ? formatSceneTime(state.trim_out_s) : "");
  const video = useRef<HTMLVideoElement>(null);
  const isVideo = state.kind === "video";
  const start = parseClock(from);
  const end = parseClock(to);
  const error = isVideo ? trimError(start, end, state.source_duration_s) : null;
  const src = coreUrl(fileUrl);
  const ratio = state.target_width > state.target_height ? "16:9" : "9:16";

  const submit = () =>
    save.mutate(
      {
        sceneId: state.scene_id,
        assetId: state.asset_id,
        input: {
          mode,
          crop: mode === "crop" ? crop : null,
          trim_in_s: isVideo ? start : null,
          trim_out_s: isVideo ? end : null,
        },
      },
      {
        onSuccess: (r) => {
          toast.success(r.job ? "Encuadrando el video en segundo plano…" : "Encuadre guardado");
          onClose();
        },
      },
    );

  const mark = (set: (v: string) => void) => {
    const t = video.current?.currentTime;
    if (t != null) set(formatSceneTime(t));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Encuadre</DialogTitle>
        <DialogDescription>
          Formato {ratio} ({state.target_width}×{state.target_height}).{" "}
          {state.orientation_mismatch && "El medio tiene otra orientación: recórtalo o usa fondo desenfocado."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Modo de encuadre">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-md border px-3 py-2 text-left transition-colors",
              mode === m.id ? "border-brand bg-active" : "hover:bg-panel-2",
            )}
          >
            <div className="text-[13px] font-medium">{m.label}</div>
            <div className="text-[11px] text-muted-foreground">{m.hint}</div>
          </button>
        ))}
      </div>

      <div className="flex justify-center rounded-md bg-black/40 p-3">
        {mode === "blur" ? (
          <BlurPreview src={src} isVideo={isVideo} ratio={state.target_width / state.target_height} />
        ) : (
          <CropArea
            src={src}
            isVideo={isVideo}
            videoRef={video}
            aspect={(state.source_width ?? 16) / (state.source_height ?? 9)}
            crop={mode === "crop" ? crop : null}
            onMove={(dx, dy) => setCrop((c) => moveCrop(c, dx, dy))}
          />
        )}
      </div>

      {mode === "crop" && (
        <label className="flex items-center gap-3 text-[12px] text-muted-foreground">
          Tamaño del recorte
          <input
            type="range"
            aria-label="Tamaño del recorte"
            min={30}
            max={100}
            value={Math.round(cropScale(crop, max) * 100)}
            onChange={(e) => {
              const { cx, cy } = cropCenter(crop);
              setCrop(scaledCrop(max, Number(e.target.value) / 100, cx, cy));
            }}
            className="flex-1 accent-[var(--accent)]"
          />
          <Button size="xs" variant="ghost" onClick={() => setCrop(max)}>
            Centrar
          </Button>
        </label>
      )}

      {isVideo && (
        <div className="grid gap-2">
          <div className="text-[12px] font-medium">
            Tramo del video{" "}
            <span className="font-normal text-muted-foreground">
              (dura {formatSceneTime(state.source_duration_s)}; vacío = desde el inicio o hasta el final)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input aria-label="Inicio" placeholder="Inicio" value={from} onChange={(e) => setFrom(e.target.value)} className="w-28" />
            <Button size="sm" variant="outline" onClick={() => mark(setFrom)}>
              Marcar inicio aquí
            </Button>
            <Input aria-label="Fin" placeholder="Fin" value={to} onChange={(e) => setTo(e.target.value)} className="ml-3 w-28" />
            <Button size="sm" variant="outline" onClick={() => mark(setTo)}>
              Marcar fin aquí
            </Button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {mode !== "none" && (
            <p className="text-[12px] text-muted-foreground">
              Con recorte o fondo desenfocado, FFmpeg genera el video encuadrado en segundo plano.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={!!error || save.isPending} onClick={submit}>
          {save.isPending && <LoaderCircle className="animate-spin" />}
          Guardar encuadre
        </Button>
      </DialogFooter>
    </>
  );
}

function CropArea({
  src,
  isVideo,
  videoRef,
  aspect,
  crop,
  onMove,
}: {
  src: string | undefined;
  isVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  aspect: number;
  crop: Crop | null;
  onMove: (dx: number, dy: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!last.current || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    onMove((e.clientX - last.current.x) / rect.width, (e.clientY - last.current.y) / rect.height);
    last.current = { x: e.clientX, y: e.clientY };
  };

  return (
    <div
      ref={box}
      className="relative max-h-[360px] max-w-full overflow-hidden"
      style={{ aspectRatio: aspect, height: aspect >= 1 ? undefined : 360, width: aspect >= 1 ? 640 : undefined }}
      data-testid="crop-area"
    >
      {isVideo ? (
        <video ref={videoRef} src={src} controls={!crop} className="size-full object-contain" />
      ) : (
        <img src={src} alt="" className="size-full object-contain" />
      )}
      {crop && (
        <div
          data-testid="crop-rect"
          className="absolute cursor-move border-2 border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
          onPointerDown={(e) => {
            last.current = { x: e.clientX, y: e.clientY };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => (last.current = null)}
        />
      )}
      {crop && isVideo && (
        <button
          type="button"
          className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white"
          onClick={() => (videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause())}
        >
          Reproducir / pausar
        </button>
      )}
    </div>
  );
}

function BlurPreview({ src, isVideo, ratio }: { src: string | undefined; isVideo: boolean; ratio: number }) {
  const Media = isVideo ? "video" : "img";
  return (
    <div
      className="relative overflow-hidden rounded"
      style={{ aspectRatio: ratio, height: ratio >= 1 ? undefined : 360, width: ratio >= 1 ? 640 : undefined }}
      data-testid="blur-preview"
    >
      <Media src={src} className="absolute inset-0 size-full scale-110 object-cover blur-xl brightness-75" muted autoPlay={isVideo} loop />
      <Media src={src} className="relative size-full object-contain" muted autoPlay={isVideo} loop />
    </div>
  );
}
