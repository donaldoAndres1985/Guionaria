import { Music, Pause, Play, Search, Sparkles, Volume2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAssignSound, useSceneSounds, useSoundSuggestions, useSounds } from "@/hooks/useSounds";
import { coreUrl, type Sound, type SoundKind } from "@/lib/api";
import { formatSeconds, usePreview } from "./usePreview";

const ROLE_LABEL: Record<SoundKind, string> = { sfx: "SFX", music: "Música" };

/** SFX y música de la escena: entran al timeline en sus propias pistas (sección 5.12). */
export function SceneSoundsBar({ sceneId, sfxCue, musicCue }: { sceneId: number; sfxCue: string | null; musicCue: string | null }) {
  const { data } = useSceneSounds(sceneId);
  const assign = useAssignSound();
  const preview = usePreview();
  const [picking, setPicking] = useState<SoundKind | null>(null);

  const slot = (role: SoundKind, sound: Sound | null, cue: string | null) => (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-[12px]">
      {role === "sfx" ? <Volume2 className="size-3.5 shrink-0 text-brand" /> : <Music className="size-3.5 shrink-0 text-brand" />}
      <span className="shrink-0 text-muted-foreground">{ROLE_LABEL[role]}:</span>
      {sound ? (
        <>
          <button
            type="button"
            aria-label={`Escuchar ${sound.title}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => preview.toggle(`${role}${sound.id}`, coreUrl(sound.file_url)!)}
          >
            {preview.playing === `${role}${sound.id}` ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <span className="min-w-0 truncate font-medium">{sound.title}</span>
          <button
            type="button"
            aria-label={`Quitar ${ROLE_LABEL[role]}`}
            className="text-muted-foreground hover:text-danger"
            onClick={() => assign.mutate({ sceneId, role, soundId: null })}
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <span className="min-w-0 truncate text-subtle">{cue ? `Pide: ${cue}` : "Sin asignar"}</span>
      )}
      <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPicking(role)}>
        Elegir
      </Button>
    </div>
  );

  return (
    <div className="mb-4 flex gap-2" aria-label="Sonido de la escena">
      {slot("sfx", data?.sfx ?? null, sfxCue)}
      {slot("music", data?.music ?? null, musicCue)}
      <SoundPicker sceneId={sceneId} role={picking} cue={picking === "sfx" ? sfxCue : musicCue} onClose={() => setPicking(null)} />
    </div>
  );
}

function SoundPicker({ sceneId, role, cue, onClose }: { sceneId: number; role: SoundKind | null; cue: string | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { data: sounds = [] } = useSounds({ kind: role, q });
  const { data: suggested = [] } = useSoundSuggestions(sceneId, role ?? "sfx", role !== null);
  const assign = useAssignSound();
  const preview = usePreview();
  const pick = (id: number) => role && assign.mutate({ sceneId, role, soundId: id }, { onSuccess: onClose });

  const row = (s: Sound, highlight = false) => (
    <div key={`${highlight ? "s" : "l"}${s.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-panel-2/60">
      <Button size="icon-xs" variant="outline" aria-label={`Escuchar ${s.title}`} onClick={() => preview.toggle(`p${s.id}`, coreUrl(s.file_url)!)}>
        {preview.playing === `p${s.id}` ? <Pause /> : <Play />}
      </Button>
      {highlight && <Sparkles className="size-3.5 text-brand" />}
      <span className="min-w-0 flex-1 truncate">
        {s.title} <span className="text-[12px] text-muted-foreground">{s.tags.slice(0, 4).join(", ")}</span>
      </span>
      <span className="text-[12px] text-muted-foreground">{formatSeconds(s.duration_s)}</span>
      <Button size="xs" variant="outline" onClick={() => pick(s.id)}>
        Usar
      </Button>
    </div>
  );

  return (
    <Dialog open={role !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{role === "music" ? "Música de la escena" : "Efecto de la escena"}</DialogTitle>
          <DialogDescription>
            {role === "music"
              ? "El tema empieza en esta escena y sigue hasta la próxima que tenga otra música."
              : "El efecto suena al inicio de la escena."}
            {cue && ` La escena pide: «${cue}».`}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Buscar en la biblioteca de sonidos" placeholder="Título, etiqueta o mood" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid max-h-80 gap-0.5 overflow-y-auto">
          {!q && suggested.map((s) => row(s, true))}
          {sounds.filter((s) => q || !suggested.some((x) => x.id === s.id)).map((s) => row(s))}
          {sounds.length === 0 && (
            <p className="p-3 text-[12px] text-muted-foreground">
              No hay sonidos. Agrégalos en{" "}
              <Link to="/sfx-musica" className="text-brand hover:underline">
                SFX y música
              </Link>
              .
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
