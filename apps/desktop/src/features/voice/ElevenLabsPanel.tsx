import { KeyRound, LoaderCircle, Pause, Play, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElevenAccount, useElevenModels, useElevenVoices } from "@/hooks/useVoice";
import type { ElevenLabsPrefs, ElevenVoice } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Créditos que costaría generar este texto con el modelo elegido. */
export function estimateCredits(chars: number, creditsPerChar: number) {
  return Math.ceil(chars * creditsPerChar);
}

const SLIDERS: { key: "stability" | "similarity_boost" | "style" | "speed"; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: "stability", label: "Estabilidad", hint: "Baja = más expresiva; alta = más uniforme", min: 0, max: 1, step: 0.05 },
  { key: "similarity_boost", label: "Similitud", hint: "Qué tanto se parece a la voz original", min: 0, max: 1, step: 0.05 },
  { key: "style", label: "Estilo", hint: "Exagera el estilo del locutor (gasta más tiempo)", min: 0, max: 1, step: 0.05 },
  { key: "speed", label: "Velocidad", hint: "0.7 = lenta · 1.2 = rápida", min: 0.7, max: 1.2, step: 0.05 },
];

export function ElevenLabsPanel({
  configured,
  prefs,
  onChange,
  characters,
  disabled,
}: {
  configured: boolean;
  prefs: ElevenLabsPrefs;
  onChange: (patch: Partial<ElevenLabsPrefs>) => void;
  /** Caracteres del guion que se enviarían. */
  characters: number;
  disabled?: boolean;
}) {
  const voices = useElevenVoices(configured);
  const models = useElevenModels(configured);
  const account = useElevenAccount(configured);
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = voices.data ?? [];
    if (!q) return list;
    return list.filter((v) =>
      [v.name, v.description ?? "", ...Object.values(v.labels)].some((t) => t.toLowerCase().includes(q)),
    );
  }, [voices.data, query]);

  if (!configured) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-dashed p-4 text-[13px]">
        <KeyRound className="size-4 shrink-0 text-brand" />
        <span className="flex-1 text-muted-foreground">
          Para usar ElevenLabs agrega tu clave en Ajustes. Piper sigue disponible gratis y sin conexión.
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/ajustes">Ir a Ajustes</Link>
        </Button>
      </div>
    );
  }

  const model = models.data?.find((m) => m.id === prefs.model_id) ?? models.data?.[0];
  const cost = model ? estimateCredits(characters, model.credits_per_char) : null;
  const remaining = account.data?.remaining ?? null;
  const short = cost != null && remaining != null && cost > remaining;

  const preview = (v: ElevenVoice) => {
    if (!v.preview_url) return;
    audio.current?.pause();
    if (playing === v.voice_id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(v.preview_url);
    audio.current = a;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    setPlaying(v.voice_id);
  };

  return (
    <div className="grid gap-4 rounded-md border p-4">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
        {/* Voces */}
        <div className="grid min-w-0 gap-2">
          <div className="flex items-center justify-between text-[12px] text-muted-foreground">
            <span>Voz de ElevenLabs</span>
            {prefs.voice_name && (
              <span>
                Elegida: <span className="font-medium text-foreground">{prefs.voice_name}</span>
              </span>
            )}
          </div>
          <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, acento, género…"
              aria-label="Buscar voz"
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none"
            />
          </label>
          <div className="max-h-56 overflow-y-auto rounded-md border" role="listbox" aria-label="Voces de ElevenLabs">
            {voices.isLoading && (
              <p className="flex items-center gap-2 p-3 text-[12px] text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" /> Cargando voces…
              </p>
            )}
            {voices.isError && (
              <p className="p-3 text-[12px] text-danger">{(voices.error as Error).message}</p>
            )}
            {filtered.map((v) => {
              const active = v.voice_id === prefs.voice_id;
              return (
                <div
                  key={v.voice_id}
                  role="option"
                  aria-selected={active}
                  tabIndex={0}
                  onClick={() => !disabled && onChange({ voice_id: v.voice_id, voice_name: v.name })}
                  onKeyDown={(e) => e.key === "Enter" && !disabled && onChange({ voice_id: v.voice_id, voice_name: v.name })}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 border-b px-2.5 py-2 text-[12px] last:border-b-0",
                    active ? "bg-active" : "hover:bg-panel-2",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Escuchar ${v.name}`}
                    disabled={!v.preview_url}
                    onClick={(e) => {
                      e.stopPropagation();
                      preview(v);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-foreground hover:bg-brand hover:text-primary-foreground disabled:opacity-30"
                  >
                    {playing === v.voice_id ? <Pause className="size-3" /> : <Play className="size-3" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", active && "text-active-foreground")}>{v.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[v.category === "premade" ? "Biblioteca" : v.category, ...Object.values(v.labels)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </div>
              );
            })}
            {voices.data && filtered.length === 0 && (
              <p className="p-3 text-[12px] text-muted-foreground">Ninguna voz coincide con «{query}».</p>
            )}
          </div>
        </div>

        {/* Modelo y ajustes */}
        <div className="grid content-start gap-3">
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Modelo
            <Select value={prefs.model_id} onValueChange={(v) => onChange({ model_id: v })} disabled={disabled}>
              <SelectTrigger className="w-full" aria-label="Modelo de ElevenLabs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(models.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    <span className="ml-2 text-[11px] text-muted-foreground">{m.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {SLIDERS.map((s) => (
            <label key={s.key} className="grid gap-1 text-[12px] text-muted-foreground" title={s.hint}>
              <span className="flex justify-between">
                {s.label}
                <span className="font-mono text-foreground">{prefs[s.key].toFixed(2)}</span>
              </span>
              <input
                type="range"
                aria-label={s.label}
                min={s.min}
                max={s.max}
                step={s.step}
                value={prefs[s.key]}
                disabled={disabled}
                onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
                className="accent-[var(--accent)]"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Créditos */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-background px-3 py-2 text-[12px]",
          short && "text-danger",
        )}
        data-testid="eleven-credits"
      >
        <span>
          Esta voz gastará ≈ <span className="font-mono font-medium">{cost?.toLocaleString("es") ?? "—"}</span> créditos
          <span className="text-muted-foreground"> ({characters.toLocaleString("es")} caracteres)</span>
        </span>
        {remaining != null && (
          <span className="text-muted-foreground">
            Te quedan <span className="font-mono text-foreground">{remaining.toLocaleString("es")}</span> este mes
          </span>
        )}
        {short && (
          <span className="flex items-center gap-1 font-medium">
            <TriangleAlert className="size-3.5" /> No alcanzan: usa Turbo/Flash (mitad de créditos) o Piper
          </span>
        )}
        {account.data?.tier === "free" && (
          <span className="basis-full text-[11px] text-warning">
            Plan gratuito: exige atribución a ElevenLabs y no permite uso comercial (monetizar en YouTube requiere un
            plan de pago).
          </span>
        )}
      </div>
    </div>
  );
}
