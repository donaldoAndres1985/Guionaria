import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Music, Pause, Play, Star, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ATTRIBUTION_EXAMPLE } from "@/features/sounds/attribution";
import { UploadSoundDialog } from "@/features/sounds/UploadSoundDialog";
import { useSounds, useToggleFavoriteSound, useUpdateSound } from "@/hooks/useSounds";
import { timelineKey } from "@/hooks/useTimeline";
import { api, type BackgroundAudio, coreUrl, type Sound } from "@/lib/api";

const NONE = "__none__";

/** «Tranquility · Kevin MacLeod»: el autor ayuda a reconocerlo en la lista. */
const soundLabel = (s: Sound) => (s.author ? `${s.title} · ${s.author}` : s.title);

export function useBackground(projectId: number) {
  return useQuery({
    queryKey: ["background", projectId],
    queryFn: () => api.get<BackgroundAudio>(`/api/projects/${projectId}/background`),
  });
}

export const backgroundSummary = (bg: BackgroundAudio | undefined) =>
  bg?.sound_id ? `${bg.title ?? "Audio"} · ${bg.volume} %` : "Sin audio de fondo";

/**
 * Audio de fondo en bucle (videos religiosos, reflexiones): un tema de la biblioteca que se
 * repite todo el video, con su volumen, fundidos y bajando cuando habla la voz. Su atribución
 * (la que pide la licencia) va a los créditos de la descripción.
 */
export function BackgroundAudioPanel({
  projectId,
  channelId,
  disabled,
}: {
  projectId: number;
  /** Canal del proyecto: sus favoritos salen primero. */
  channelId?: number;
  disabled?: boolean;
}) {
  const client = useQueryClient();
  const { data: bg } = useBackground(projectId);
  const { data: music = [] } = useSounds({ kind: "music" });
  const updateSound = useUpdateSound();
  const toggleFavorite = useToggleFavoriteSound();
  const [uploadOpen, setUploadOpen] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const isFavorite = (s: Sound) => channelId != null && (s.favorite_channels ?? []).includes(channelId);
  const favorites = music.filter(isFavorite);
  const others = music.filter((s) => !isFavorite(s));
  const current = music.find((s) => s.id === bg?.sound_id);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const [attribution, setAttribution] = useState("");
  useEffect(() => setVolume(null), [bg?.volume]);
  useEffect(() => setAttribution(bg?.attribution ?? ""), [bg?.sound_id, bg?.attribution]);

  const save = useMutation({
    mutationFn: (body: { sound_id: number | null; volume: number }) =>
      api.put<BackgroundAudio>(`/api/projects/${projectId}/background`, body),
    onSuccess: (state) => {
      client.setQueryData(["background", projectId], state);
      void client.invalidateQueries({ queryKey: [...timelineKey(projectId), "preview"] });
      void client.invalidateQueries({ queryKey: ["publishing", projectId] });
    },
  });
  const shown = volume ?? bg?.volume ?? 35;
  const choose = (soundId: number | null) => save.mutate({ sound_id: soundId, volume: shown });

  return (
    <div className="grid gap-3 text-[12px]" aria-label="Audio de fondo">
      <p className="text-[11px] text-subtle">
        Se repite durante todo el video, entra y sale con fundido y baja cuando habla la voz. Reemplaza la música por escena.
      </p>
      <div className="flex gap-2">
        <Select value={bg?.sound_id ? String(bg.sound_id) : NONE} disabled={disabled} onValueChange={(v) => choose(v === NONE ? null : Number(v))}>
          <SelectTrigger className="min-w-0 flex-1" aria-label="Audio de fondo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sin audio de fondo</SelectItem>
            {favorites.length > 0 && (
              <SelectGroup>
                <SelectLabel>★ Favoritos del canal</SelectLabel>
                {favorites.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {soundLabel(s)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {others.length > 0 && (
              <SelectGroup>
                {favorites.length > 0 && <SelectLabel>Toda la biblioteca</SelectLabel>}
                {others.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {soundLabel(s)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setUploadOpen(true)} title="Sube un MP3, WAV, OGG… con su atribución">
          <Upload /> Subir
        </Button>
        <UploadSoundDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          kind="music"
          channelId={channelId}
          onAdded={([added]) => added && choose(added.id)}
        />
      </div>

      {bg?.missing && <p className="text-warning">El audio elegido ya no está en la biblioteca.</p>}

      {bg?.sound_id && !bg.missing && (
        <>
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={playing ? "Pausar audio" : "Escuchar audio"}
              onClick={() => {
                const a = player.current;
                if (!a) return;
                if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => {});
                else {
                  a.pause();
                  setPlaying(false);
                }
              }}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <Music className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{bg.title}</span>
            {channelId != null && current && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={isFavorite(current) ? "Quitar de favoritos del canal" : "Marcar como favorito del canal"}
                aria-pressed={isFavorite(current)}
                title={isFavorite(current) ? "Favorito de este canal" : "Guardar como favorito de este canal"}
                onClick={() => toggleFavorite.mutate({ id: current.id, channelId, favorite: !isFavorite(current) })}
              >
                <Star className={isFavorite(current) ? "fill-brand text-brand" : undefined} />
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Quitar audio de fondo" onClick={() => choose(null)}>
              <X />
            </Button>
            <audio ref={player} src={coreUrl(bg.file_url) ?? ""} loop onEnded={() => setPlaying(false)} />
          </div>
          <label className="grid gap-0.5">
            <span className="flex justify-between text-muted-foreground">
              Volumen del audio de fondo <span className="font-mono text-foreground">{shown} %</span>
            </span>
            <input
              type="range"
              aria-label="Volumen del audio de fondo"
              min={0}
              max={150}
              step={5}
              value={shown}
              disabled={disabled}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (player.current) player.current.volume = Math.min(v / 100, 1);
              }}
              onPointerUp={() => volume !== null && save.mutate({ sound_id: bg.sound_id, volume })}
              onKeyUp={() => volume !== null && save.mutate({ sound_id: bg.sound_id, volume })}
              className="accent-[var(--accent)]"
            />
            <span className="text-[11px] text-subtle">35 % es como la música normal; cuando habla la voz baja sola.</span>
          </label>
          <label className="grid gap-1 text-muted-foreground">
            Atribución (la que pide la licencia; va a los créditos de la descripción)
            <Textarea
              aria-label="Atribución del audio"
              rows={3}
              placeholder={ATTRIBUTION_EXAMPLE}
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              onBlur={() =>
                attribution !== (bg.attribution ?? "") &&
                updateSound.mutate(
                  { id: bg.sound_id!, attribution: attribution.trim() || null },
                  {
                    onSuccess: () => {
                      toast.success("Atribución guardada");
                      void client.invalidateQueries({ queryKey: ["background", projectId] });
                      void client.invalidateQueries({ queryKey: ["publishing", projectId] });
                    },
                  },
                )
              }
            />
          </label>
        </>
      )}
    </div>
  );
}
