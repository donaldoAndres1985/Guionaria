import { Crop as CropIcon, Film, Image as ImageIcon, KeyRound, LoaderCircle, Search, Sparkles, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { NoticeBanner } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, formatSceneTime } from "@/features/scenes/sceneMeta";
import { coreUrl, type Project } from "@/lib/api";
import { STATUS_ORDER } from "@/lib/project";
import { cn } from "@/lib/utils";
import { CandidateCard } from "./CandidateCard";
import { FramingDialog, type FramingTarget } from "./FramingDialog";
import { framingLabel } from "./framingMeta";
import { MediaViewer } from "./MediaViewer";
import { VideoUrlDialog } from "./VideoUrlDialog";
import { useMediaDrop } from "./useMediaDrop";
import { STATUS_TEXT } from "./mediaMeta";
import { type MediaController, PROVIDER_LABEL } from "./useMediaController";

export function MediaStage({
  project,
  ctl,
  onGoToScenes,
}: {
  project: Project;
  ctl: MediaController;
  onGoToScenes: () => void;
}) {
  const [framing, setFraming] = useState<FramingTarget | null>(null);
  const scenesApproved =
    STATUS_ORDER.indexOf(project.status) >= STATUS_ORDER.indexOf("ESCENAS_APROBADAS");
  const { dragging, dropProps } = useMediaDrop(
    !!ctl.scene && ctl.editable && ctl.scene.needs_media,
    ctl.importMedia,
  );

  // Atajos (sección 15.4): ←/→ escena anterior/siguiente, 1–9 elegir candidato.
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']") || e.ctrlKey || e.metaKey) return;
      const c = ctlRef.current;
      if (c.viewer) return; // la vista grande maneja sus teclas
      if (e.key === " ") c.openViewer();
      else if (e.key === "ArrowRight") c.next();
      else if (e.key === "ArrowLeft") c.prev();
      else if (/^[1-9]$/.test(e.key) && c.editable && c.scene) {
        const candidate = c.scene.candidates[Number(e.key) - 1];
        if (candidate && (candidate.download_status === "none" || candidate.download_status === "failed")) {
          c.toggle(candidate.id);
        }
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!scenesApproved) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="Primero aprueba las escenas"
        description="Los medios se buscan escena por escena a partir de la tabla aprobada, con la orientación del proyecto."
        action={
          <Button variant="outline" onClick={onGoToScenes}>
            Ir a escenas
          </Button>
        }
      />
    );
  }
  if (!ctl.overview) return null;

  const scenes = ctl.overview.scenes;
  const scene = ctl.scene;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Escenas (columna central de la referencia 03) */}
      <div className="w-64 shrink-0 overflow-y-auto border-r p-2">
        {scenes.map((s) => {
          const active = s.scene_id === ctl.sceneId;
          const done = s.status === "approved" || s.status === "manual";
          return (
            <button
              key={s.scene_id}
              type="button"
              disabled={!s.needs_media}
              onClick={() => ctl.selectScene(s.scene_id)}
              className={cn(
                "relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                active
                  ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                  : "hover:bg-panel-2/60",
                !s.needs_media && "opacity-50",
              )}
            >
              <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-panel-2 text-muted-foreground">
                {s.approved_thumb_url ? (
                  <img src={coreUrl(s.approved_thumb_url)} alt="" className="size-full object-cover" />
                ) : s.media_kind === "video" ? (
                  <Film className="size-4" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12px]">
                  <span className="font-mono text-subtle">{s.position}</span>
                  <span className="font-medium">{KIND_LABEL[s.media_kind]}</span>
                </span>
                <span className="line-clamp-1 text-[12px] text-muted-foreground">
                  {s.visual_description}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  done ? "text-success-foreground" : s.downloaded_count ? "text-brand" : "text-subtle",
                )}
              >
                {!s.needs_media
                  ? "—"
                  : done
                    ? "✓"
                    : s.downloaded_count
                      ? `${s.downloaded_count}↓`
                      : s.candidate_count || ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Escena seleccionada (también zona para soltar archivos) */}
      <div className="relative flex min-w-0 flex-1 flex-col" {...dropProps}>
        {dragging && scene && (
          <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand bg-background/85 text-center">
            <span className="text-[15px] font-medium">Suelta para agregar a la escena {scene.position}</span>
            <span className="text-[12px] text-muted-foreground">
              Si lo sueltas sobre un medio que no se pudo descargar, lo reemplaza.
            </span>
          </div>
        )}
        {!scene ? (
          <EmptyState icon={ImageIcon} title="Elige una escena" description="Solo las escenas de video, imagen o material real necesitan medio." />
        ) : (
          <>
            <div className="shrink-0 space-y-2 border-b px-5 py-3">
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="font-medium">
                  Escena {scene.position} · {KIND_LABEL[scene.media_kind]}
                </span>
                <span className="font-mono text-[11px] text-subtle">
                  {formatSceneTime(scene.start_s)} – {formatSceneTime(scene.end_s)}
                </span>
                <span className="ml-auto text-[12px] text-muted-foreground">
                  {STATUS_TEXT[scene.status] ?? scene.status}
                </span>
              </div>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">
                <span className="text-foreground/80">{scene.visual_description}</span>
                {scene.narration && <> · “{scene.narration}”</>}
              </p>

              {ctl.available.length === 0 ? (
                <NoticeBanner
                  action={
                    <div className="flex gap-1">
                      {/* Video desde URL no necesita claves: sigue disponible. */}
                      {ctl.editable && (
                        <Button size="sm" variant="ghost" onClick={() => ctl.openVideoDialog()}>
                          <Film /> Video desde URL
                        </Button>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/ajustes">
                          <KeyRound /> Ir a Ajustes
                        </Link>
                      </Button>
                    </div>
                  }
                >
                  Para buscar {scene.media_kind === "video" ? "video" : "imágenes"} de stock necesitas
                  la clave gratuita de Pexels o Pixabay.
                </NoticeBanner>
              ) : (
                ctl.editable && (
                  <>
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void ctl.search();
                      }}
                    >
                      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3">
                        <Search className="size-4 text-muted-foreground" />
                        <input
                          value={ctl.query}
                          onChange={(e) => ctl.setQuery(e.target.value)}
                          placeholder={scene.media_kind === "real" ? "Búsqueda del material real" : "Búsqueda en inglés para stock"}
                          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                        />
                      </label>
                      {ctl.available.map((p) => {
                        const on = ctl.providers.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              ctl.setProviders(on ? ctl.providers.filter((x) => x !== p) : [...ctl.providers, p])
                            }
                            className={cn(
                              "h-9 rounded-md border px-3 text-[12px] transition-colors disabled:opacity-40",
                              on ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2",
                            )}
                          >
                            {PROVIDER_LABEL[p] ?? p}
                          </button>
                        );
                      })}
                      <Button type="submit" disabled={ctl.searching || !ctl.query.trim()}>
                        {ctl.searching ? <LoaderCircle className="animate-spin" /> : <Search />}
                        Buscar
                      </Button>
                    </form>
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <label className="flex items-center gap-1.5 text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={ctl.anyOrientation}
                          onChange={(e) => ctl.setAnyOrientation(e.target.checked)}
                          className="accent-[var(--accent)]"
                        />
                        Incluir otras orientaciones (se recortarán)
                      </label>
                      <span className="text-subtle">
                        · También puedes arrastrar archivos o pegar (Ctrl+V) una imagen o dirección
                      </span>
                      <button
                        type="button"
                        onClick={() => ctl.openVideoDialog()}
                        className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Film className="size-3.5" /> Video desde URL
                      </button>
                      <button
                        type="button"
                        disabled={ctl.suggesting}
                        onClick={() => void ctl.suggest()}
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {ctl.suggesting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-brand" />}
                        Sugerir búsquedas con Claude
                      </button>
                      {ctl.suggestions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void ctl.search({ query: q })}
                          className="rounded-full border px-2.5 py-0.5 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                )
              )}
            </div>

            {ctl.warnings.length > 0 && <NoticeBanner>{ctl.warnings.join(" · ")}</NoticeBanner>}

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {scene.approved.length > 0 && (
                <section className="mb-5">
                  <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">Aprobado</h3>
                  <div className="flex flex-wrap gap-3">
                    {scene.approved.map((a) => (
                      <div key={a.asset.id} className="flex items-center gap-3 rounded-md border bg-background p-2 pr-3">
                        <img
                          src={
                            a.framing_mode !== "none" && a.asset.kind === "image" && a.approved_url
                              ? `${coreUrl(a.approved_url)}?v=${encodeURIComponent(a.framing_mode + a.file_name)}`
                              : coreUrl(a.asset.thumb_url)
                          }
                          alt=""
                          className={cn(
                            "rounded object-cover",
                            ctl.overview?.orientation === "portrait" ? "h-16 w-9" : "h-9 w-16",
                          )}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-[12px] font-medium">
                            <Star className="size-3 text-success-foreground" />
                            {a.role === "main" ? "Principal" : "Alterno"}
                          </div>
                          <div className="max-w-64 truncate font-mono text-[11px] text-subtle" title={a.file_name}>
                            {a.file_name}
                          </div>
                          {framingLabel(a) && (
                            <div className="flex items-center gap-1 text-[11px] text-brand">
                              {a.framing_pending && <LoaderCircle className="size-3 animate-spin" />}
                              {framingLabel(a)}
                            </div>
                          )}
                        </div>
                        {ctl.editable && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={a.framing_pending}
                            onClick={() =>
                              setFraming({ sceneId: scene.scene_id, assetId: a.asset.id, fileUrl: a.asset.file_url })
                            }
                          >
                            <CropIcon /> Encuadre
                          </Button>
                        )}
                        {ctl.editable && (
                          <button
                            type="button"
                            onClick={() => ctl.unapprove(a.asset.id)}
                            aria-label="Quitar aprobación"
                            className="text-muted-foreground hover:text-danger"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {scene.candidates.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-muted-foreground">
                  {ctl.searching
                    ? "Buscando…"
                    : ctl.importing
                      ? "Agregando…"
                      : "Sin candidatos todavía. Busca, arrastra un archivo o pega (Ctrl+V) una imagen o dirección."}
                </p>
              ) : (
                <>
                  <div
                    className={cn(
                      "grid gap-3",
                      ctl.overview?.orientation === "portrait"
                        ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"
                        : "grid-cols-[repeat(auto-fill,minmax(210px,1fr))]",
                    )}
                  >
                    {scene.candidates.map((c, i) => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        index={i}
                        orientation={ctl.overview!.orientation}
                        selected={ctl.selected.includes(c.id)}
                        approvedRole={scene.approved.find((a) => a.asset.id === c.asset?.id)?.role ?? null}
                        editable={ctl.editable}
                        onToggle={() => ctl.toggle(c.id)}
                        onApprove={(role) => c.asset && ctl.approve(c.asset.id, role)}
                        onRetry={() => ctl.retry(c.id)}
                        onOpen={() => ctl.openViewer(c.id)}
                        onHover={(h) => ctl.setHovered(h ? c.id : null)}
                        dragging={dragging}
                      />
                    ))}
                  </div>
                  {ctl.hasMore && ctl.editable && (
                    <div className="mt-4 text-center">
                      <Button variant="outline" disabled={ctl.searching} onClick={() => void ctl.loadMore()}>
                        Mostrar más
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
      <MediaViewer ctl={ctl} />
      <VideoUrlDialog ctl={ctl} />
      <FramingDialog projectId={project.id} target={framing} onClose={() => setFraming(null)} />
    </div>
  );
}
