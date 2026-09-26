import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardPaste,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  type LucideIcon,
  Music,
  PlugZap,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHealth, useTestKey } from "@/hooks/useCore";
import { useOpenUrl } from "@/hooks/useManualMedia";
import type { ApiKeys, AppSettings, KeyProvider, KeyTestResult } from "@/lib/api";
import { cn } from "@/lib/utils";

type Capability = "photo" | "video" | "sound";

const CAPABILITIES: Record<Capability, { label: string; icon: LucideIcon }> = {
  photo: { label: "Fotos", icon: ImageIcon },
  video: { label: "Videos", icon: Film },
  sound: { label: "Sonido", icon: Music },
};

interface KeyedProvider {
  id: keyof ApiKeys;
  name: string;
  description: string;
  monogram: string;
  tint: string;
  capabilities: Capability[];
  keyName: string;
  signupUrl: string;
  steps: string[];
  limit: string;
}

export const KEYED_PROVIDERS: KeyedProvider[] = [
  {
    id: "pexels",
    name: "Pexels",
    description: "Fuente principal de video de stock en vertical y horizontal.",
    monogram: "Px",
    tint: "#05a081",
    capabilities: ["photo", "video"],
    keyName: "API Key",
    signupUrl: "https://www.pexels.com/api/new/",
    steps: [
      "Inicia sesión o crea una cuenta gratuita en Pexels.",
      "Completa el formulario de solicitud (uso: proyecto personal).",
      "Copia la clave que aparece en «Your API Key».",
    ],
    limit: "200 peticiones/hora · 20 000/mes",
  },
  {
    id: "pixabay",
    name: "Pixabay",
    description: "Fotos, ilustraciones y videos libres de derechos.",
    monogram: "Pb",
    tint: "#3aa757",
    capabilities: ["photo", "video"],
    keyName: "API Key",
    signupUrl: "https://pixabay.com/api/docs/",
    steps: [
      "Inicia sesión o crea una cuenta gratuita en Pixabay.",
      "Abre la documentación de la API: tu clave aparece resaltada en «Parameters → key».",
      "Cópiala tal cual, sin espacios.",
    ],
    limit: "100 peticiones/minuto",
  },
  {
    id: "unsplash",
    name: "Unsplash",
    description: "Fotografía de alta calidad; no incluye video.",
    monogram: "Us",
    tint: "#8b8580",
    capabilities: ["photo"],
    keyName: "Access Key",
    signupUrl: "https://unsplash.com/oauth/applications/new",
    steps: [
      "Regístrate como desarrollador en unsplash.com/developers.",
      "Crea una aplicación nueva y acepta las condiciones de uso.",
      "Copia la «Access Key» (el Secret Key no se usa).",
    ],
    limit: "50 peticiones/hora (modo demo)",
  },
  {
    id: "freesound",
    name: "Freesound",
    description: "Efectos de sonido con licencia Creative Commons.",
    monogram: "Fs",
    tint: "#4f7fd6",
    capabilities: ["sound"],
    keyName: "API Key",
    signupUrl: "https://freesound.org/apiv2/apply",
    steps: [
      "Inicia sesión o crea una cuenta en Freesound.",
      "Rellena el formulario «Apply for an API key».",
      "Copia el valor «Client secret / Api key».",
    ],
    limit: "2 000 peticiones/día",
  },
];

interface Props {
  settings: AppSettings;
  saved: AppSettings | undefined;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function ApiKeysSettings({ settings, saved, onChange }: Props) {
  const health = useHealth();
  const [testAll, setTestAll] = useState(0);
  const ytdlp = health.data?.dependencies.find((d) => d.name === "yt-dlp");

  const configured = KEYED_PROVIDERS.filter((p) => settings.api_keys[p.id]);
  const coverage = (cap: Capability) =>
    configured.filter((p) => p.capabilities.includes(cap)).length +
    (cap === "photo" ? 2 : 0) + // Openverse y Wikimedia no piden clave
    (cap === "video" && ytdlp?.ok ? 1 : 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-5">
      {/* Resumen */}
      <section className="rounded-lg border bg-panel p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted-foreground">Claves configuradas</p>
            <p className="mt-1 font-mono text-2xl font-semibold">
              {configured.length}
              <span className="text-muted-foreground">/{KEYED_PROVIDERS.length}</span>
            </p>
            <div className="mt-3 flex gap-1" aria-hidden>
              {KEYED_PROVIDERS.map((p) => (
                <span
                  key={p.id}
                  className={cn("h-1.5 flex-1 rounded-full", settings.api_keys[p.id] ? "bg-brand" : "bg-panel-2")}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {(Object.keys(CAPABILITIES) as Capability[]).map((cap) => {
              const n = coverage(cap);
              const C = CAPABILITIES[cap];
              return (
                <div key={cap} className="w-24 rounded-md bg-background px-3 py-2.5">
                  <C.icon className={cn("size-4", n ? "text-brand" : "text-subtle")} strokeWidth={1.8} />
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{C.label}</p>
                  <p className="text-[13px] font-medium" data-testid={`coverage-${cap}`}>
                    {n} {n === 1 ? "fuente" : "fuentes"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t pt-4 text-[12px] text-muted-foreground">
          <Lock className="size-3.5 shrink-0" />
          <span className="flex-1">
            Todas son gratuitas y se guardan solo en tu equipo (config\settings.json), nunca en el repositorio.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={configured.length === 0}
            onClick={() => setTestAll((n) => n + 1)}
          >
            <PlugZap />
            Probar todas
          </Button>
        </div>
      </section>

      {/* Con clave */}
      <section className="flex flex-col gap-3">
        <SectionTitle title="Con clave de API" hint="Se crean en minutos con una cuenta gratuita." />
        {KEYED_PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            value={settings.api_keys[p.id]}
            savedValue={saved?.api_keys[p.id] ?? ""}
            testSignal={testAll}
            onChange={(v) => onChange({ api_keys: { ...settings.api_keys, [p.id]: v } })}
          />
        ))}
      </section>

      {/* Sin clave */}
      <section className="flex flex-col gap-3">
        <SectionTitle title="Sin clave" hint="Funcionan sin registrarte." />
        <div className="divide-y rounded-lg border bg-panel">
          <KeylessRow
            icon={ImageIcon}
            name="Openverse"
            description="Imágenes con licencia Creative Commons."
            ready
          />
          <KeylessRow
            icon={ImageIcon}
            name="Wikimedia Commons"
            description="Fotos de archivo y material real con licencia libre."
            ready
          />
          <KeylessRow
            icon={Film}
            name="yt-dlp"
            description="Descarga de video desde una URL (YouTube, X, noticias…)."
            ready={ytdlp?.ok ?? true}
            detail={ytdlp?.ok ? ytdlp.version ?? undefined : ytdlp?.detail ?? undefined}
          />
          <SearxngRow
            value={settings.searxng_url}
            savedValue={saved?.searxng_url ?? ""}
            testSignal={testAll}
            onChange={(v) => onChange({ searxng_url: v })}
          />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <span className="text-[12px] text-muted-foreground">{hint}</span>
    </div>
  );
}

/** Resultado de la última prueba, válido solo mientras el valor no cambie. */
function useKeyTest(provider: KeyProvider, value: string, testSignal: number) {
  const test = useTestKey(provider);
  const [result, setResult] = useState<{ value: string; data: KeyTestResult } | null>(null);
  const run = () => {
    const tested = value;
    test.mutate(tested, { onSuccess: (data) => setResult({ value: tested, data }) });
  };
  useEffect(() => {
    if (testSignal > 0 && value) run();
    // Solo al pulsar «Probar todas».
  }, [testSignal]);
  const current = result && result.value === value ? result.data : null;
  return { run, pending: test.isPending, result: current, failed: test.isError };
}

function ProviderCard({
  provider: p,
  value,
  savedValue,
  testSignal,
  onChange,
}: {
  provider: KeyedProvider;
  value: string;
  savedValue: string;
  testSignal: number;
  onChange: (value: string) => void;
}) {
  const openUrl = useOpenUrl();
  const [visible, setVisible] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const { run, pending, result, failed } = useKeyTest(p.id, value, testSignal);
  const inputId = `key-${p.id}`;

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onChange(text.trim());
    } catch {
      document.getElementById(inputId)?.focus();
    }
  };

  return (
    <article
      aria-label={p.name}
      className={cn(
        "rounded-lg border bg-panel p-4 transition-colors",
        result?.status === "invalid" && "border-danger/50",
      )}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-semibold"
          style={{ backgroundColor: `${p.tint}26`, color: p.tint }}
        >
          {p.monogram}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[14px] font-semibold">{p.name}</h4>
            {p.capabilities.map((cap) => {
              const C = CAPABILITIES[cap];
              return (
                <span
                  key={cap}
                  className="inline-flex items-center gap-1 rounded bg-panel-2 px-1.5 py-px text-[11px] text-muted-foreground"
                >
                  <C.icon className="size-3" />
                  {C.label}
                </span>
              );
            })}
            {value !== savedValue && (
              <span className="rounded bg-active px-1.5 py-px text-[11px] text-active-foreground">Sin guardar</span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{p.description}</p>
        </div>
        <StatusPill value={value} pending={pending} result={result} />
      </header>

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <label htmlFor={inputId} className="sr-only">
            {p.keyName} de {p.name}
          </label>
          <Input
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder={`Pega aquí tu ${p.keyName}`}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && value && run()}
            className="pr-20 font-mono placeholder:font-sans"
          />
          <div className="absolute inset-y-0 right-1 flex items-center">
            {value ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={visible ? "Ocultar clave" : "Mostrar clave"}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <EyeOff /> : <Eye />}
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="Borrar clave" onClick={() => onChange("")}>
                  <X />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="xs" aria-label="Pegar clave" onClick={() => void paste()}>
                <ClipboardPaste />
                Pegar
              </Button>
            )}
          </div>
        </div>
        <Button variant="outline" disabled={!value || pending} onClick={run}>
          {pending ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Probar
        </Button>
      </div>

      {(result || failed) && (
        <p
          role="status"
          className={cn(
            "mt-2 text-[12px]",
            !result || result.status === "invalid" || result.status === "error"
              ? "text-danger"
              : result.status === "valid"
                ? "text-success-foreground"
                : "text-warning",
          )}
        >
          {result ? resultLine(result) : "No se pudo contactar con el núcleo para probar la clave."}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          onClick={() => openUrl.mutate(p.signupUrl)}
        >
          Obtener clave <ExternalLink className="size-3" />
        </button>
        <button
          type="button"
          aria-expanded={showSteps}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setShowSteps((s) => !s)}
        >
          {showSteps ? "Ocultar pasos" : "¿Cómo la obtengo?"}
        </button>
        <span className="ml-auto text-subtle">Límite gratuito: {p.limit}</span>
      </footer>

      {showSteps && (
        <ol className="mt-3 flex flex-col gap-1.5 rounded-md bg-background p-3 text-[12px] text-muted-foreground">
          {p.steps.map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-panel-2 font-mono text-[10px] text-foreground">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
          <li className="mt-1 text-subtle">Después pégala arriba, pulsa «Probar» y guarda los ajustes.</li>
        </ol>
      )}
    </article>
  );
}

function resultLine(r: KeyTestResult) {
  const extra = [
    r.latency_ms != null && `${r.latency_ms} ms`,
    r.quota_remaining != null && `${r.quota_remaining.toLocaleString("es")} peticiones restantes`,
  ].filter(Boolean);
  return extra.length ? `${r.message} · ${extra.join(" · ")}` : r.message;
}

const STATUS: Record<KeyTestResult["status"], { label: string; icon: LucideIcon; tone: string }> = {
  valid: { label: "Verificada", icon: CircleCheck, tone: "bg-success text-success-foreground" },
  invalid: { label: "Clave rechazada", icon: CircleX, tone: "bg-danger/15 text-danger" },
  rate_limited: { label: "Límite alcanzado", icon: CircleAlert, tone: "bg-warning/15 text-warning" },
  unreachable: { label: "Sin conexión", icon: CircleAlert, tone: "bg-warning/15 text-warning" },
  error: { label: "Error", icon: CircleX, tone: "bg-danger/15 text-danger" },
  missing: { label: "Sin configurar", icon: CircleDashed, tone: "bg-panel-2 text-subtle" },
};

function StatusPill({ value, pending, result }: { value: string; pending: boolean; result: KeyTestResult | null }) {
  let label = "Sin probar";
  let Icon: LucideIcon = CircleDashed;
  let tone = "bg-panel-2 text-muted-foreground";
  if (pending) {
    label = "Probando…";
    Icon = Loader2;
  } else if (!value) {
    ({ label, icon: Icon, tone } = STATUS.missing);
  } else if (result) {
    ({ label, icon: Icon, tone } = STATUS[result.status]);
  }
  return (
    <span
      data-testid="key-status"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}
    >
      <Icon className={cn("size-3", pending && "animate-spin")} />
      {label}
    </span>
  );
}

function KeylessRow({
  icon: Icon,
  name,
  description,
  ready,
  detail,
}: {
  icon: LucideIcon;
  name: string;
  description: string;
  ready: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-panel-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{name}</p>
        <p className="truncate text-[12px] text-muted-foreground">{description}</p>
      </div>
      {detail && <span className="selectable truncate font-mono text-[11px] text-subtle">{detail}</span>}
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
          ready ? "bg-success text-success-foreground" : "bg-danger/15 text-danger",
        )}
      >
        {ready ? <CircleCheck className="size-3" /> : <CircleX className="size-3" />}
        {ready ? "Listo" : "No disponible"}
      </span>
    </div>
  );
}

function SearxngRow({
  value,
  savedValue,
  testSignal,
  onChange,
}: {
  value: string;
  savedValue: string;
  testSignal: number;
  onChange: (value: string) => void;
}) {
  const { run, pending, result, failed } = useKeyTest("searxng", value, testSignal);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-panel-2">
          <Globe className="size-4 text-muted-foreground" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            SearXNG
            {value !== savedValue && (
              <span className="rounded bg-active px-1.5 py-px text-[11px] font-normal text-active-foreground">
                Sin guardar
              </span>
            )}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            Metabuscador propio en Docker para imágenes web de material real.
          </p>
        </div>
        <StatusPill value={value} pending={pending} result={result} />
      </div>
      <div className="mt-3 flex gap-2 pl-11">
        <label htmlFor="searxng-url" className="sr-only">
          URL de SearXNG
        </label>
        <Input
          id="searxng-url"
          spellCheck={false}
          placeholder="http://127.0.0.1:8888"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && value && run()}
          className="font-mono"
        />
        <Button variant="outline" disabled={!value || pending} onClick={run}>
          {pending ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Probar
        </Button>
      </div>
      {(result || failed) && (
        <p
          role="status"
          className={cn("mt-2 pl-11 text-[12px]", result?.status === "valid" ? "text-success-foreground" : "text-warning")}
        >
          {result ? resultLine(result) : "No se pudo contactar con el núcleo."}
        </p>
      )}
    </div>
  );
}
