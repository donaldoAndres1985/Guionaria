import { Copy, Download, ExternalLink, FileText, Music, Pause, Play, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FormField } from "@/components/FormField";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyText } from "@/features/publishing/ManualKit";
import { ATTRIBUTION_EXAMPLE, attributionsText } from "@/features/sounds/attribution";
import { UploadSoundDialog } from "@/features/sounds/UploadSoundDialog";
import { formatSeconds, MOODS, usePreview } from "@/features/sounds/usePreview";
import { useChannels } from "@/hooks/useChannels";
import { useOpenUrl } from "@/hooks/useManualMedia";
import {
  useDeleteSound,
  useFreesoundSearch,
  useSaveFreesound,
  useSoundTags,
  useSounds,
  useToggleFavoriteSound,
  useUpdateSound,
  useUploadSounds,
} from "@/hooks/useSounds";
import { coreUrl, type Sound, type SoundKind } from "@/lib/api";
import { cn } from "@/lib/utils";

const AUDIO_ACCEPT = ".wav,.mp3,.ogg,.flac,.m4a,.aac";
const NO_MOOD = "none";
const ALL_CHANNELS = "all";

export function SfxMusicPage() {
  const [kind, setKind] = useState<SoundKind>("sfx");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [freesoundOpen, setFreesoundOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [favoriteOf, setFavoriteOf] = useState<number | null>(null);
  const [withAttribution, setWithAttribution] = useState(false);
  const { data: channels = [] } = useChannels();
  const { data: sounds = [], isPending } = useSounds({ kind, q, tag, favoriteOf, withAttribution });
  const credits = attributionsText(sounds);
  const { data: tags = [] } = useSoundTags(kind);
  const upload = useUploadSounds();
  const preview = usePreview();
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = sounds.find((s) => s.id === selectedId) ?? null;

  return (
    <PageLayout
      title="SFX y música"
      actions={
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            className="hidden"
            data-testid="sound-files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length)
                upload.mutate(
                  { files, kind },
                  { onSuccess: (added) => toast.success(`${added.length} ${added.length === 1 ? "sonido agregado" : "sonidos agregados"}`) },
                );
            }}
          />
          <Button variant="outline" className="h-10 bg-panel" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            <Upload /> Importar archivos
          </Button>
          <Button variant="outline" className="h-10 bg-panel" onClick={() => setAddOpen(true)}>
            <Plus /> Agregar con atribución
          </Button>
          <Button variant="outline" className="h-10 bg-panel" onClick={() => setFreesoundOpen((o) => !o)}>
            <Search /> Buscar en Freesound
          </Button>
        </div>
      }
      bottomBar={
        <BottomBar
          stats={[
            { label: kind === "sfx" ? "Efectos" : "Temas", value: sounds.length, highlight: true },
            { label: "En uso", value: sounds.filter((s) => s.used_in > 0).length },
            { label: "Con atribución", value: sounds.filter((s) => s.attribution?.trim()).length },
          ]}
        />
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {(
          [
            ["sfx", "Efectos de sonido"],
            ["music", "Música"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setKind(id);
              setTag(null);
              setSelectedId(null);
            }}
            className={cn("rounded px-3 py-1.5 text-[13px]", kind === id ? "bg-panel-2 font-medium" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Select value={favoriteOf ? String(favoriteOf) : ALL_CHANNELS} onValueChange={(v) => setFavoriteOf(v === ALL_CHANNELS ? null : Number(v))}>
            <SelectTrigger className="h-9 w-48" aria-label="Favoritos del canal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CHANNELS}>Todos los canales</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  ★ Favoritos de {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-pressed={withAttribution}
            onClick={() => setWithAttribution((v) => !v)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
              withAttribution ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileText className="size-3.5" /> Con atribución
          </button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={!credits}
            title="Copia las atribuciones de los audios de la lista, listas para la descripción"
            onClick={() => void copyText(credits, "Atribuciones")}
          >
            <Copy /> Copiar atribuciones
          </Button>
        </div>
        <div className="relative w-56">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Buscar sonidos" placeholder="Título, etiqueta o mood" className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => setTag(tag === t.tag ? null : t.tag)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[12px]",
                tag === t.tag ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.tag} <span className="text-subtle">{t.count}</span>
            </button>
          ))}
        </div>
      )}
      <UploadSoundDialog open={addOpen} onClose={() => setAddOpen(false)} kind={kind} channelId={favoriteOf} onAdded={([first]) => first && setSelectedId(first.id)} />
      {freesoundOpen && <FreesoundPanel kind={kind} preview={preview} onClose={() => setFreesoundOpen(false)} />}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!isPending && sounds.length === 0 ? (
            <EmptyState
              icon={Music}
              title={kind === "sfx" ? "Todavía no hay efectos" : "Todavía no hay música"}
              description={
                kind === "sfx"
                  ? "Importa tus packs de efectos o búscalos en Freesound (gratis, con clave de API)."
                  : "Importa música descargada, por ejemplo de la Biblioteca de audio de YouTube, y etiquétala por mood y BPM."
              }
            />
          ) : (
            <div className="divide-y">
              {sounds.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(s.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(s.id)}
                  className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-panel-2/60", selectedId === s.id && "bg-panel-2")}
                >
                  <PlayButton playing={preview.playing === `s${s.id}`} onClick={() => preview.toggle(`s${s.id}`, coreUrl(s.file_url)!)} label={s.title} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {s.title}
                      {(s.favorite_channels?.length ?? 0) > 0 && <Star aria-label="Favorito" className="size-3 shrink-0 fill-brand text-brand" />}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[s.mood, s.bpm ? `${s.bpm} BPM` : null, ...s.tags].filter(Boolean).join(" · ") || "Sin etiquetas"}
                    </span>
                  </span>
                  <span className="w-20 shrink-0 text-right text-[12px] text-muted-foreground">{formatSeconds(s.duration_s)}</span>
                  <span className="w-32 shrink-0 truncate text-[12px] text-muted-foreground" title={s.attribution ?? undefined}>
                    {s.license ?? "Propio"}
                    {s.attribution?.trim() && <span className="block truncate text-[11px] text-subtle">{s.author ?? "Con atribución"}</span>}
                  </span>
                  <span className={cn("w-24 shrink-0 text-[12px]", s.used_in ? "text-success-foreground" : "text-subtle")}>
                    {s.used_in ? `${s.used_in} ${s.used_in === 1 ? "escena" : "escenas"}` : "Sin usar"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {selected && <SoundDetail key={selected.id} sound={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </PageLayout>
  );
}

function PlayButton({ playing, onClick, label }: { playing: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-label={`${playing ? "Pausar" : "Escuchar"} ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  );
}

function SoundDetail({ sound, onClose }: { sound: Sound; onClose: () => void }) {
  const update = useUpdateSound();
  const remove = useDeleteSound();
  const openUrl = useOpenUrl();
  const toggleFavorite = useToggleFavoriteSound();
  const { data: channels = [] } = useChannels();
  const [title, setTitle] = useState(sound.title);
  const [tags, setTags] = useState(sound.tags.join(", "));
  const [bpm, setBpm] = useState(sound.bpm ? String(sound.bpm) : "");
  const [author, setAuthor] = useState(sound.author ?? "");
  const [license, setLicense] = useState(sound.license ?? "");
  const [attribution, setAttribution] = useState(sound.attribution ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l" aria-label="Detalle del sonido">
      <div className="flex h-11 items-center border-b px-4 text-[13px] font-medium">
        Detalle
        <button type="button" aria-label="Cerrar detalle" className="ml-auto text-muted-foreground" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-4 p-4">
        <audio src={coreUrl(sound.file_url)} controls className="w-full" />
        <FormField label="Título">
          <Input aria-label="Título" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== sound.title && save({ id: sound.id, title: title.trim() })} />
        </FormField>
        <FormField label="Etiquetas" hint="Separadas por comas: whoosh, impact, static…">
          <Input
            aria-label="Etiquetas"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => save({ id: sound.id, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) })}
          />
        </FormField>
        {sound.kind === "music" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mood">
              <Select value={sound.mood ?? NO_MOOD} onValueChange={(v) => save({ id: sound.id, mood: v === NO_MOOD ? null : v })}>
                <SelectTrigger className="w-full" aria-label="Mood">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MOOD}>Sin mood</SelectItem>
                  {MOODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="BPM">
              <Input
                aria-label="BPM"
                type="number"
                min={20}
                max={300}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                onBlur={() => save({ id: sound.id, bpm: bpm ? Number(bpm) : null })}
              />
            </FormField>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Autor">
            <Input aria-label="Autor" value={author} onChange={(e) => setAuthor(e.target.value)} onBlur={() => author !== (sound.author ?? "") && save({ id: sound.id, author: author.trim() || null })} />
          </FormField>
          <FormField label="Licencia">
            <Input aria-label="Licencia" placeholder="CC BY 4.0" value={license} onChange={(e) => setLicense(e.target.value)} onBlur={() => license !== (sound.license ?? "") && save({ id: sound.id, license: license.trim() || null })} />
          </FormField>
        </div>
        <FormField label="Atribución" hint="El texto que pide la licencia: va a los créditos de la descripción cuando uses este audio.">
          <Textarea
            aria-label="Atribución"
            rows={3}
            placeholder={ATTRIBUTION_EXAMPLE}
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            onBlur={() => attribution !== (sound.attribution ?? "") && save({ id: sound.id, attribution: attribution.trim() || null })}
          />
        </FormField>
        {channels.length > 0 && (
          <FormField label="Favorito de" hint="Sale primero al elegir audio en esos canales. Cualquier canal puede usarlo.">
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => {
                const on = sound.favorite_channels?.includes(c.id) ?? false;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleFavorite.mutate({ id: sound.id, channelId: c.id, favorite: !on })}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px]",
                      on ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Star className={cn("size-3", on && "fill-brand text-brand")} /> {c.name}
                  </button>
                );
              })}
            </div>
          </FormField>
        )}
        <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[12px]">
          <dt className="text-muted-foreground">Origen</dt>
          <dd>{sound.provider === "freesound" ? "Freesound" : "Importado"}</dd>
          <dt className="text-muted-foreground">Duración</dt>
          <dd>{formatSeconds(sound.duration_s)}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          {sound.source_url && (
            <Button size="sm" variant="outline" onClick={() => openUrl.mutate(sound.source_url!)}>
              <ExternalLink /> Origen
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-danger" disabled={sound.used_in > 0} title={sound.used_in ? "Quítalo de las escenas y del audio de fondo antes de borrarlo" : undefined} onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Borrar
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Borrar «${sound.title}»?`}
        description="Se borra el archivo de la biblioteca."
        confirmLabel="Borrar sonido"
        destructive
        onConfirm={() => remove.mutate(sound.id, { onSuccess: () => { setConfirmDelete(false); onClose(); } })}
      />
    </aside>
  );
}

function FreesoundPanel({ kind, preview, onClose }: { kind: SoundKind; preview: ReturnType<typeof usePreview>; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isFetching } = useFreesoundSearch(query, page);
  const save = useSaveFreesound();

  return (
    <section className="border-b bg-panel/50 p-3" aria-label="Freesound">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft);
          setPage(1);
        }}
      >
        <Input aria-label="Buscar en Freesound" placeholder="whoosh, impact, static… (en inglés da más resultados)" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={!draft.trim() || isFetching}>
          <Search /> Buscar
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Cerrar Freesound" onClick={onClose}>
          <X />
        </Button>
      </form>
      {error && <p className="mt-2 text-[12px] text-danger">{(error as Error).message}</p>}
      {data && (
        <div className="mt-3 grid max-h-72 gap-1 overflow-y-auto">
          {data.results.map((r) => (
            <div key={r.freesound_id} className="flex items-center gap-3 rounded px-2 py-1.5 text-[13px] hover:bg-panel-2/60">
              <PlayButton playing={preview.playing === `f${r.freesound_id}`} onClick={() => preview.toggle(`f${r.freesound_id}`, r.preview_url)} label={r.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {r.author} · {r.license} · {r.tags.slice(0, 5).join(", ")}
                </span>
              </span>
              <span className="w-16 text-right text-[12px] text-muted-foreground">{formatSeconds(r.duration_s)}</span>
              <Button
                size="xs"
                variant={r.saved_sound_id ? "ghost" : "outline"}
                disabled={!!r.saved_sound_id || save.isPending}
                onClick={() => save.mutate({ result: r, kind }, { onSuccess: () => toast.success(`«${r.title}» guardado en la biblioteca`) })}
              >
                <Download /> {r.saved_sound_id ? "Guardado" : "Guardar"}
              </Button>
            </div>
          ))}
          {data.results.length === 0 && <p className="p-3 text-[12px] text-muted-foreground">Sin resultados.</p>}
          {data.has_more && (
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)}>
              Más resultados
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
