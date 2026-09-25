import { Check, LoaderCircle, RotateCw, Star, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { coreUrl, type Candidate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { canSelect, formatClip, formatResolution, orientationMismatch } from "./mediaMeta";
import { PROVIDER_LABEL } from "./useMediaController";

interface CandidateCardProps {
  candidate: Candidate;
  index: number;
  orientation: "landscape" | "portrait";
  selected: boolean;
  approvedRole: "main" | "alt" | null;
  editable: boolean;
  onToggle: () => void;
  onApprove: (role: "main" | "alt") => void;
  onRetry: () => void;
}

/** Tarjeta de un candidato (referencia 03): miniatura, datos y estado de descarga. */
export function CandidateCard({
  candidate: c,
  index,
  orientation,
  selected,
  approvedRole,
  editable,
  onToggle,
  onApprove,
  onRetry,
}: CandidateCardProps) {
  const video = useRef<HTMLVideoElement>(null);
  const thumb = coreUrl(c.asset?.thumb_url) ?? c.preview_url ?? undefined;
  const busy = c.download_status === "queued" || c.download_status === "downloading";
  const done = c.download_status === "done" && c.asset;
  const selectable = editable && canSelect(c);
  const resolution = formatResolution(c.asset?.width ?? c.width, c.asset?.height ?? c.height);
  const clip = formatClip(c.asset?.duration_s ?? c.duration_s);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border bg-background transition-colors",
        selected && "border-brand ring-1 ring-brand",
        approvedRole === "main" && "border-success-foreground ring-1 ring-success-foreground",
      )}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (video.current) {
          video.current.pause();
          video.current.currentTime = 0;
        }
      }}
    >
      <button
        type="button"
        disabled={!selectable}
        onClick={onToggle}
        aria-label={`${selected ? "Quitar" : "Elegir"} candidato ${index + 1}`}
        aria-pressed={selected}
        className={cn(
          "relative block w-full bg-panel-2",
          orientation === "portrait" ? "aspect-[9/16]" : "aspect-video",
          selectable ? "cursor-pointer" : "cursor-default",
        )}
      >
        {thumb && (
          <img src={thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        )}
        {c.kind === "video" && c.video_preview_url && (
          <video
            ref={video}
            src={c.video_preview_url}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 size-full object-cover opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}

        {/* Casilla de selección y número para el atajo 1–9 */}
        {selectable && (
          <span
            className={cn(
              "absolute top-2 left-2 flex size-5 items-center justify-center rounded border text-[11px] font-semibold",
              selected ? "border-brand bg-brand text-primary-foreground" : "border-white/60 bg-black/40 text-white",
            )}
          >
            {selected ? <Check className="size-3.5" /> : index < 9 ? index + 1 : ""}
          </span>
        )}
        {approvedRole && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-success px-1.5 py-0.5 text-[11px] font-medium text-success-foreground">
            <Star className="size-3" /> {approvedRole === "main" ? "Principal" : "Alterno"}
          </span>
        )}
        {clip && (
          <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 font-mono text-[11px] text-white">
            {clip}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-[12px] text-white">
            <LoaderCircle className="size-5 animate-spin" />
            {c.download_status === "queued" ? "En cola" : "Descargando…"}
          </span>
        )}
      </button>

      <div className="space-y-1 p-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{PROVIDER_LABEL[c.provider] ?? c.provider}</span>
          {resolution && <span className="font-mono">{resolution}</span>}
          {orientationMismatch(c, orientation) && (
            <span title="Otra orientación: se recortará" className="text-warning">
              ⤢
            </span>
          )}
          {c.asset?.low_res && (
            <span className="rounded bg-warning/15 px-1 text-warning" title="Solo se pudo bajar la miniatura grande">
              baja res.
            </span>
          )}
        </div>
        {c.author && <div className="truncate text-[11px] text-subtle">{c.author}</div>}

        {c.download_status === "failed" && (
          <div className="space-y-1">
            <p className="flex gap-1 text-[11px] leading-snug text-danger">
              <TriangleAlert className="mt-px size-3 shrink-0" />
              <span className="line-clamp-2" title={c.error ?? ""}>
                {c.error}
              </span>
            </p>
            {editable && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="size-3" /> Reintentar
              </button>
            )}
          </div>
        )}

        {done && editable && approvedRole !== "main" && (
          <div className="flex gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => onApprove("main")}
              className="flex-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-brand-hover"
            >
              Aprobar
            </button>
            {approvedRole !== "alt" && (
              <button
                type="button"
                onClick={() => onApprove("alt")}
                title="Guardar como alterno"
                className="rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-panel-2 hover:text-foreground"
              >
                Alterno
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
