import { CalendarClock, Check, Copy, ExternalLink, FolderOpen, ImageIcon, LoaderCircle, Send, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { useProjectJob } from "@/hooks/useProjectJob";
import { publishingKey, usePlaylists, usePublishing, usePublishingActions } from "@/hooks/usePublishing";
import { coreUrl, type Project, type Publication, type PublicationUpdate, type PublishingState } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PLATFORM_TONE, STATUS_TEXT, fromLocalInput, splitList, toLocalInput } from "./publishingMeta";
import { CoverDesigner } from "./CoverDesigner";
import { ImagePreviewProvider, useImagePreview } from "./ImagePreview";
import { YouTubeSetup } from "./YouTubeSetup";
import { useNavigate } from "react-router";

const CATEGORIES = [
  { id: "22", label: "Personas y blogs" },
  { id: "25", label: "Noticias y política" },
  { id: "27", label: "Educación" },
  { id: "24", label: "Entretenimiento" },
  { id: "1", label: "Cine y animación" },
];

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar"),
  );
}

/** Controlador de la etapa: estado, trabajos (textos con Claude y subida a YouTube) y acciones. */
export function usePublishController(project: Project, enabled = true) {
  const [waitingGoogle, setWaitingGoogle] = useState(false);
  const { data: state } = usePublishing(project.id, waitingGoogle, enabled);
  const actions = usePublishingActions(project.id);
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: publishingKey(project.id) });
    void client.invalidateQueries({ queryKey: ["publishing", "queue"] });
    void client.invalidateQueries({ queryKey: ["project", project.id] });
  };
  const [selected, setSelected] = useState<number | null>(null);
  const uploadId = useRef<number | null>(null);
  const titlesFor = useRef<number | null>(null);
  const titles = useProjectJob(project.id, "publishing_titles", () => actions.suggestTitles(titlesFor.current!), (job) => {
    toast.success(`${job.result?.titles ?? 0} títulos propuestos`);
    refresh();
  });
  const coverJob = useProjectJob(project.id, "publishing_cover", actions.designCover, (job) => {
    toast.success(`${job.result?.options ?? 0} miniaturas propuestas`);
    refresh();
  });
  const generate = useProjectJob(project.id, "publishing_metadata", actions.generate, (job) => {
    toast.success(`Textos listos para ${job.result?.platforms ?? 0} plataformas`);
    void refresh();
  });
  const upload = useProjectJob(project.id, "publish", () => actions.upload(uploadId.current!), (job) => {
    const r = job.result ?? {};
    toast.success(r.scheduled ? "Subido a YouTube y programado" : "Subido a YouTube", { description: String(r.url ?? "") });
    for (const w of (r.warnings as string[] | undefined) ?? []) toast.warning(w);
    void refresh();
  });
  const pub = state?.publications.find((p) => p.id === selected) ?? state?.publications[0] ?? null;
  return {
    state,
    actions,
    pub,
    select: setSelected,
    generate,
    upload,
    /** Sube a YouTube la publicación `id`. */
    startUpload: (id: number) => {
      uploadId.current = id;
      void upload.start();
    },
    setWaitingGoogle,
    titles,
    /** Claude propone títulos con gancho para la publicación `id`. */
    startTitles: (id: number) => {
      titlesFor.current = id;
      void titles.start();
    },
    coverJob,
  };
}

export type PublishController = ReturnType<typeof usePublishController>;

export function PublishStage({ project, ctl, onGoToTimeline }: { project: Project; ctl: PublishController; onGoToTimeline: () => void }) {
  const { state, pub } = ctl;
  if (!state) return null;
  if (!state.can_publish) {
    return (
      <EmptyState
        icon={Send}
        title="Primero renderiza el video final"
        description={state.reason ?? "Cuando tengas el MP4 final podrás preparar la publicación en cada plataforma."}
        action={<Button onClick={onGoToTimeline}>Ir al Timeline</Button>}
      />
    );
  }
  return (
    <ImagePreviewProvider>
      <div className="flex min-h-0 flex-1">
        <aside
          className="grid w-80 shrink-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-x-hidden overflow-y-auto border-r p-4"
          aria-label="Plataformas"
        >
          <PlatformList state={state} ctl={ctl} />
          <CoverDesigner state={state} ctl={ctl} />
          <Cover state={state} ctl={ctl} project={project} />
          <Credits credits={state.credits} />
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">{pub && <PublicationEditor key={pub.id} pub={pub} state={state} ctl={ctl} />}</div>
      </div>
    </ImagePreviewProvider>
  );
}

function PlatformList({ state, ctl }: { state: PublishingState; ctl: PublishController }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="text-[12px] font-medium text-muted-foreground">Publicar en</h3>
      {state.publications.map((p) => (
        <div
          key={p.id}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors",
            ctl.pub?.id === p.id ? "border-brand bg-active" : "hover:bg-panel-2",
          )}
        >
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => ctl.select(p.id)}>
            <span className={cn("size-2.5 shrink-0 rounded-full", PLATFORM_TONE[p.platform])} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{p.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {p.enabled ? STATUS_TEXT[p.status](p) : "No se publica aquí"}
              </span>
            </span>
          </button>
          <Switch
            aria-label={`Publicar en ${p.label}`}
            checked={p.enabled}
            onCheckedChange={(v) => ctl.actions.update.mutate({ id: p.id, data: { enabled: v } })}
          />
        </div>
      ))}
    </div>
  );
}

/** Miniatura: se elige un cuadro del video y, si se quiere, un texto encima. */
function Cover({ state, ctl, project }: { state: PublishingState; ctl: PublishController; project: Project }) {
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const first = state.publications[0];
  const [text, setText] = useState(first?.meta.thumbnail_text ?? project.title);
  const [over, setOver] = useState(false);
  const thumb = state.publications.find((p) => p.thumbnail_url)?.thumbnail_url;
  const upload = ctl.actions.uploadCover;
  const preview = useImagePreview();
  const send = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Eso no es una imagen: usa JPG, PNG o WebP");
        return;
      }
      upload.mutate(file, { onSuccess: () => toast.success("Miniatura propia lista") });
    },
    [upload],
  );
  // Ctrl+V en cualquier parte de la etapa: si el portapapeles trae una imagen, es la miniatura.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      send(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [send]);
  return (
    <div className="grid gap-2" aria-label="Miniatura">
      <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <ImageIcon className="size-3.5" /> Miniatura actual
      </h3>
      <div
        data-testid="cover-drop"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files[0]);
        }}
        className={cn(
          "grid place-items-center gap-2 rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground transition-colors",
          over && "border-brand bg-active",
        )}
      >
        {thumb ? (
          <img
            src={coreUrl(thumb) ?? ""}
            alt="Miniatura"
            title="Doble clic: ver grande"
            onDoubleClick={() => preview({ url: coreUrl(thumb) ?? "", title: "Miniatura actual" })}
            className="max-h-64 max-w-full cursor-zoom-in rounded object-contain"
          />
        ) : (
          <ImageIcon className="size-6 text-subtle" />
        )}
        <span>
          ¿La hiciste con otra herramienta? Arrástrala aquí, pégala con <span className="font-mono">Ctrl+V</span> o
        </span>
        <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => picker.current?.click()}>
          {upload.isPending ? <LoaderCircle className="animate-spin" /> : <Upload />} Subir imagen
        </Button>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Archivo de miniatura"
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <h4 className="text-[11px] text-muted-foreground">O elige un cuadro del video a mano:</h4>
      {state.video_url && (
        <video ref={video} src={coreUrl(state.video_url) ?? ""} controls muted preload="metadata" className="max-h-44 max-w-full rounded bg-black" />
      )}
      <Input aria-label="Texto de la miniatura" placeholder="Texto encima (vacío = sin texto)" value={text} onChange={(e) => setText(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={ctl.actions.thumbnail.isPending}
        onClick={() =>
          ctl.actions.thumbnail.mutate(
            { time_s: video.current?.currentTime ?? 0, text: text.trim() || null },
            { onSuccess: () => toast.success("Miniatura lista") },
          )
        }
      >
        {ctl.actions.thumbnail.isPending ? <LoaderCircle className="animate-spin" /> : <ImageIcon />} Usar este cuadro
      </Button>
      <p className="text-[11px] text-subtle">Pausa el video en el cuadro que quieras. Se toma del medio original (sin subtítulos).</p>
    </div>
  );
}

function Credits({ credits }: { credits: string }) {
  if (!credits) return null;
  return (
    <div className="grid gap-1.5">
      <h3 className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
        Créditos de los medios
        <button type="button" className="text-brand hover:underline" onClick={() => copy(credits, "Créditos")}>
          Copiar
        </button>
      </h3>
      <pre className="max-h-40 overflow-y-auto rounded bg-panel-2 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">{credits}</pre>
    </div>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cn("font-mono text-[11px]", value > max ? "text-danger" : "text-subtle")}>{value}/{max}</span>;
}

/** Campo de texto que guarda al salir (si cambió). */
function useField(initial: string, save: (v: string) => void) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const commit = useCallback(() => {
    if (value !== initial) save(value);
  }, [value, initial, save]);
  return { value, setValue, commit };
}

function PublicationEditor({ pub, state, ctl }: { pub: Publication; state: PublishingState; ctl: PublishController }) {
  const openUrl = useOpenUrl();
  const locked = pub.status === "published" || pub.status === "uploading";
  const save = useCallback((data: PublicationUpdate) => ctl.actions.update.mutate({ id: pub.id, data }), [ctl.actions.update, pub.id]);
  const title = useField(pub.title, (v) => save({ title: v }));
  const description = useField(pub.description, (v) => save({ description: v }));
  const hashtags = useField(pub.meta.hashtags.map((h) => `#${h}`).join(" "), (v) => save({ hashtags: splitList(v) }));
  const tags = useField(pub.tags.join(", "), (v) => save({ tags: splitList(v, ",") }));
  const pinned = useField(pub.meta.pinned_comment ?? "", (v) => save({ pinned_comment: v || null }));
  const [url, setUrl] = useState("");
  const [when, setWhen] = useState(toLocalInput(pub.scheduled_at));
  const youtube = pub.platform === "youtube";
  const playlists = usePlaylists(state.channel_id, youtube && state.youtube.connected);
  const uploading = ctl.upload.running; // solo YouTube se sube desde la app

  return (
    <div className="grid max-w-3xl gap-5 p-5" aria-label={`Publicación en ${pub.label}`}>
      {/* Estado */}
      {pub.status === "published" && pub.external_url && (
        <Banner tone="success" icon={Check}>
          Publicado en {pub.label}:{" "}
          <button type="button" className="underline" onClick={() => openUrl.mutate(pub.external_url!)}>
            {pub.external_url}
          </button>
          <button type="button" className="ml-auto text-[12px] text-muted-foreground hover:text-foreground" onClick={() => ctl.actions.reopen.mutate(pub.id)}>
            Volver a borrador
          </button>
        </Banner>
      )}
      {pub.status === "scheduled" && pub.scheduled_at && (
        <Banner tone="info" icon={CalendarClock}>
          {pub.external_url ? "Subido y programado" : "Programado"} para el {new Date(pub.scheduled_at).toLocaleString("es")}
          {pub.external_url && (
            <button type="button" className="ml-2 underline" onClick={() => openUrl.mutate(pub.external_url!)}>
              ver
            </button>
          )}
        </Banner>
      )}
      {pub.status === "failed" && pub.error && (
        <Banner tone="danger" icon={TriangleAlert}>
          {pub.error}
        </Banner>
      )}
      {pub.meta.warning && (
        <Banner tone="warning" icon={TriangleAlert}>
          {pub.meta.warning}
        </Banner>
      )}

      {/* Título */}
      <div className="grid gap-1.5">
        <label className="flex items-center justify-between text-[12px] text-muted-foreground" htmlFor={`title-${pub.id}`}>
          Título <Counter value={title.value.length} max={pub.limits.title} />
        </label>
        {pub.meta.title_options.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Títulos propuestos">
            {pub.meta.title_options.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={pub.title === t}
                disabled={locked}
                onClick={() => save({ title: t })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-left text-[12px] disabled:opacity-50",
                  pub.title === t ? "border-brand bg-active text-active-foreground" : "hover:bg-panel-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <Input id={`title-${pub.id}`} aria-label="Título" disabled={locked} value={title.value} onChange={(e) => title.setValue(e.target.value)} onBlur={title.commit} />
        {!locked && <TitleIdeas pub={pub} ctl={ctl} onUse={(t) => save({ title: t })} />}
      </div>

      {/* Descripción y hashtags */}
      <div className="grid gap-1.5">
        <label className="flex items-center justify-between text-[12px] text-muted-foreground" htmlFor={`desc-${pub.id}`}>
          Descripción
          <Counter value={pub.full_text.length} max={pub.limits.description} />
        </label>
        <Textarea id={`desc-${pub.id}`} aria-label="Descripción" rows={4} disabled={locked} value={description.value} onChange={(e) => description.setValue(e.target.value)} onBlur={description.commit} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-[12px] text-muted-foreground">
          Hashtags
          <Input aria-label="Hashtags" disabled={locked} value={hashtags.value} onChange={(e) => hashtags.setValue(e.target.value)} onBlur={hashtags.commit} placeholder="#truecrime #caso" />
        </label>
        {youtube ? (
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            <span className="flex justify-between">
              Etiquetas <Counter value={tags.value.length} max={pub.limits.tags} />
            </span>
            <Input aria-label="Etiquetas" disabled={locked} value={tags.value} onChange={(e) => tags.setValue(e.target.value)} onBlur={tags.commit} placeholder="separadas por comas" />
          </label>
        ) : (
          <span />
        )}
      </div>
      <label className="grid gap-1.5 text-[12px] text-muted-foreground">
        Comentario fijado
        <Input aria-label="Comentario fijado" value={pinned.value} onChange={(e) => pinned.setValue(e.target.value)} onBlur={pinned.commit} />
      </label>

      {/* Opciones de YouTube */}
      {youtube && (
        <div className="grid gap-3 rounded-md border p-3 text-[12px]" aria-label="Opciones de YouTube">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">¿Contenido para niños?</span>
            <div role="radiogroup" aria-label="Contenido para niños" className="flex rounded-md border p-0.5">
              {([
                [true, "Sí, es para niños"],
                [false, "No"],
              ] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={pub.meta.made_for_kids === v}
                  disabled={locked}
                  onClick={() => save({ made_for_kids: v })}
                  className={cn("rounded px-2.5 py-0.5", pub.meta.made_for_kids === v ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2")}
                >
                  {label}
                </button>
              ))}
            </div>
            {pub.meta.made_for_kids === null && <span className="text-warning">Obligatorio en YouTube</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-muted-foreground">
              Visibilidad
              <Select value={pub.visibility} disabled={locked || !!pub.scheduled_at} onValueChange={(v) => save({ visibility: v as Publication["visibility"] })}>
                <SelectTrigger aria-label="Visibilidad">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Pública</SelectItem>
                  <SelectItem value="unlisted">No listada</SelectItem>
                  <SelectItem value="private">Privada</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-muted-foreground">
              Categoría
              <Select value={pub.meta.category_id} disabled={locked} onValueChange={(v) => save({ category_id: v })}>
                <SelectTrigger aria-label="Categoría">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          {state.youtube.connected && (
            <label className="grid gap-1 text-muted-foreground">
              Playlist
              <Select value={pub.meta.playlist_id ?? "__none__"} disabled={locked} onValueChange={(v) => save({ playlist_id: v === "__none__" ? null : v })}>
                <SelectTrigger aria-label="Playlist">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin playlist</SelectItem>
                  {(playlists.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="flex items-center justify-between gap-2">
            <span>Subir los subtítulos {state.subtitles ? "(SRT de la voz)" : "(no hay SRT)"}</span>
            <Switch aria-label="Subir subtítulos" checked={pub.meta.captions} disabled={locked || !state.subtitles} onCheckedChange={(v) => save({ captions: v })} />
          </label>
          <label className="flex items-center justify-between gap-2" title="Imágenes o voces realistas generadas que puedan confundirse con reales">
            <span>Contenido alterado o sintético realista</span>
            <Switch aria-label="Contenido sintético" checked={pub.meta.synthetic} disabled={locked} onCheckedChange={(v) => save({ synthetic: v })} />
          </label>
        </div>
      )}

      {/* Programar */}
      <div className="flex flex-wrap items-end gap-2 text-[12px]">
        <label className="grid gap-1 text-muted-foreground">
          Fecha y hora de publicación
          <Input type="datetime-local" aria-label="Fecha de publicación" disabled={locked && !!pub.external_url} value={when} onChange={(e) => setWhen(e.target.value)} className="w-56" />
        </label>
        <Button size="sm" variant="outline" disabled={!when || (locked && !!pub.external_url)} onClick={() => save({ scheduled_at: fromLocalInput(when) })}>
          <CalendarClock /> Programar
        </Button>
        {pub.scheduled_at && !pub.external_url && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setWhen("");
              save({ clear_schedule: true });
            }}
          >
            Quitar fecha
          </Button>
        )}
        <span className="text-subtle">
          {youtube ? "YouTube la publica sola a esa hora." : "Te lo recordamos en la cola; se publica a mano."}
        </span>
      </div>

      {/* Texto listo para pegar */}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          Texto listo para pegar {youtube || pub.platform === "facebook" ? "(con capítulos y créditos)" : ""}
          <div className="flex gap-3">
            <button type="button" className="text-brand hover:underline" onClick={() => copy(pub.title, "Título")}>
              <Copy className="inline size-3" /> Título
            </button>
            <button type="button" className="text-brand hover:underline" onClick={() => copy(pub.full_text, "Descripción")}>
              <Copy className="inline size-3" /> Descripción
            </button>
          </div>
        </div>
        <pre data-testid="full-text" className="max-h-56 overflow-y-auto rounded-md border bg-panel-2 p-3 text-[12px] whitespace-pre-wrap">
          {pub.full_text || "Escribe la descripción o genera los textos con Claude."}
        </pre>
      </div>

      {/* Verificación */}
      <div className="grid gap-1.5" aria-label="Antes de publicar">
        <h4 className="text-[12px] font-medium text-muted-foreground">Antes de publicar</h4>
        {pub.checklist.map((c) => (
          <label key={c.id} className="flex items-start gap-2 text-[12px]" title={c.hint ?? undefined}>
            <input
              type="checkbox"
              checked={c.done}
              disabled={!c.manual}
              onChange={(e) => save({ checks: { [c.id]: e.target.checked } })}
              className="mt-0.5 accent-[var(--accent)]"
              aria-label={c.label}
            />
            <span className={cn(c.done ? "text-foreground" : "text-muted-foreground")}>
              {c.label}
              {c.hint && <span className="block text-[11px] text-subtle">{c.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      {/* Publicar */}
      <div className="grid gap-3 border-t pt-4">
        {youtube && <YouTubeSetup state={state} onWaiting={ctl.setWaitingGoogle} />}
        {youtube && state.youtube.connected && !pub.external_url && (
          <div className="grid gap-2">
            <Button
              className="justify-self-start"
              disabled={ctl.upload.running || pub.meta.made_for_kids === null}
              title={pub.meta.made_for_kids === null ? "Indica si es contenido para niños" : undefined}
              onClick={() => ctl.startUpload(pub.id)}
            >
              {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {pub.scheduled_at ? "Subir a YouTube y programar" : "Subir a YouTube"}
            </Button>
            {uploading && (
              <div className="grid gap-1">
                <Progress value={(ctl.upload.job?.progress ?? 0) * 100} aria-label="Progreso de la subida" />
                <span className="text-[12px] text-muted-foreground">{ctl.upload.job?.message ?? "Preparando…"}</span>
              </div>
            )}
            {ctl.upload.error && <p className="text-[12px] text-danger">{ctl.upload.error}</p>}
          </div>
        )}
        {pub.status !== "published" && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Button size="sm" variant="outline" onClick={() => openUrl.mutate(pub.upload_url)}>
              <ExternalLink /> Abrir {pub.label}
            </Button>
            <Input aria-label={`Dirección publicada en ${pub.label}`} placeholder="Pega aquí la dirección cuando lo publiques" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-64 flex-1" />
            <Button
              size="sm"
              disabled={!url.trim() || ctl.actions.markPublished.isPending}
              onClick={() =>
                ctl.actions.markPublished.mutate({ id: pub.id, url: url.trim() }, { onSuccess: () => toast.success(`Marcado como publicado en ${pub.label}`) })
              }
            >
              <Check /> Marcar como publicado
            </Button>
          </div>
        )}
        {state.video_file && <p className="font-mono text-[11px] text-subtle">Video: {state.video_file}</p>}
      </div>
    </div>
  );
}

const TONE = {
  success: "border-success/40 bg-success/10",
  info: "border-brand/40 bg-active",
  warning: "border-warning/40 bg-warning/10",
  danger: "border-danger/40 bg-danger/10",
};

function Banner({ tone, icon: Icon, children }: { tone: keyof typeof TONE; icon: typeof Check; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]", TONE[tone])}>
      <Icon className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</span>
    </div>
  );
}

export function PublishBottomBar({ ctl }: { ctl: PublishController }) {
  const { state, generate } = ctl;
  const active = state?.publications.filter((p) => p.enabled) ?? [];
  const published = active.filter((p) => p.status === "published").length;
  const next = active
    .map((p) => p.scheduled_at)
    .filter(Boolean)
    .sort()[0];
  const hasText = active.some((p) => p.description);
  return (
    <BottomBar
      stats={[
        { label: "Plataformas", value: active.length ? active.map((p) => p.label).join(" · ") : "—" },
        { label: "Publicadas", value: `${published}/${active.length}`, highlight: true },
        { label: "Próxima", value: next ? new Date(next).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—" },
      ]}
    >
      {generate.error && <span className="text-[12px] text-danger">{generate.error}</span>}
      <Button variant="ghost" onClick={() => ctl.actions.reveal.mutate()} disabled={!state}>
        <FolderOpen /> Abrir carpeta
      </Button>
      <Button size="lg" className="min-w-52" disabled={!state?.can_publish || generate.running} onClick={() => void generate.start()} title="Gasta cuota de tu plan de Claude">
        {generate.running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
        {generate.running ? "Claude está escribiendo…" : hasText ? "Regenerar textos con Claude" : "Generar textos con Claude"}
      </Button>
    </BottomBar>
  );
}

/** «Proponer títulos con gancho»: Claude sigue la guía de títulos (editable en Ajustes → Claude). */
function TitleIdeas({ pub, ctl, onUse }: { pub: Publication; ctl: PublishController; onUse: (title: string) => void }) {
  const navigate = useNavigate();
  const ideas = pub.meta.title_ideas ?? [];
  const running = ctl.titles.running;
  return (
    <div className="grid gap-1.5" aria-label="Títulos con gancho">
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <Button size="sm" variant="outline" disabled={running} onClick={() => ctl.startTitles(pub.id)} title="Gasta cuota de tu plan de Claude">
          {running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {running ? "Claude está pensando títulos…" : ideas.length ? "Proponer otros títulos" : "Proponer títulos con gancho"}
        </Button>
        <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => navigate("/ajustes?categoria=claude")}>
          Editar la guía de títulos
        </button>
      </div>
      {ctl.titles.error && <p className="text-[12px] text-danger">{ctl.titles.error}</p>}
      {ideas.length > 0 && (
        <ul className="grid gap-1" aria-label="Títulos propuestos por Claude">
          {ideas.map((idea) => (
            <li key={idea.title}>
              <button
                type="button"
                onClick={() => onUse(idea.title)}
                className={cn(
                  "grid w-full gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                  pub.title === idea.title ? "border-brand bg-active" : "hover:bg-panel-2",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-medium">{idea.title}</span>
                  <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-brand">{idea.hook}</span>
                  <span className="shrink-0 font-mono text-[10px] text-subtle">{idea.title.length}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{idea.why}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
