import { Clapperboard } from "lucide-react";
import { useState } from "react";
import { coreUrl, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";

type ThumbProject = Pick<Project, "format" | "cover_url" | "media_thumbs" | "title">;

/** Portada del proyecto: la miniatura de publicación o del render; si no, su primer medio.
 * Si una imagen no carga (archivo borrado a mano o en una limpieza), prueba la siguiente y al
 * final muestra el ícono: nunca una imagen rota. */
export function ProjectCover({ project, className }: { project: ThumbProject; className?: string }) {
  const sources = [project.cover_url, ...(project.media_thumbs ?? [])].filter((s): s is string => !!s);
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((s) => !failed.includes(s)) ?? null;
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded bg-panel-2",
        project.format === "reel" ? "aspect-[9/16]" : "aspect-video",
        className,
      )}
    >
      {src ? (
        <img
          key={src}
          src={coreUrl(src) ?? ""}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed((f) => [...f, src])}
        />
      ) : (
        <Clapperboard className="size-5 text-subtle" aria-label="Sin portada" />
      )}
    </div>
  );
}

/** Tira con los medios aprobados del proyecto (hasta 5) y cuántos hay en total. */
export function MediaStrip({ project }: { project: Pick<Project, "media_thumbs" | "media_count"> }) {
  const thumbs = project.media_thumbs ?? [];
  const [failed, setFailed] = useState<string[]>([]);
  if (!thumbs.length) return <span className="text-[11px] text-subtle">Sin medios aprobados</span>;
  const extra = (project.media_count ?? thumbs.length) - thumbs.length;
  return (
    <div className="flex items-center gap-1" data-testid="media-strip">
      {thumbs.map((url) =>
        failed.includes(url) ? (
          <span key={url} className="flex size-8 items-center justify-center rounded bg-panel-2">
            <Clapperboard className="size-3.5 text-subtle" />
          </span>
        ) : (
          <img
            key={url}
            src={coreUrl(url) ?? ""}
            alt=""
            loading="lazy"
            className="size-8 rounded object-cover"
            onError={() => setFailed((f) => [...f, url])}
          />
        ),
      )}
      {extra > 0 && <span className="px-1 text-[11px] text-muted-foreground">+{extra}</span>}
    </div>
  );
}
