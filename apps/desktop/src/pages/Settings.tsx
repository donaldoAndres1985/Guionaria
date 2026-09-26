import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  FolderOpen,
  KeyRound,
  Plug,
  type LucideIcon,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHealth, useRefreshDependencies, useSaveSettings, useSettings } from "@/hooks/useCore";
import type { AppSettings, DependencyStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ApiKeysSettings, KEYED_PROVIDERS } from "@/features/settings/ApiKeysSettings";
import { ClaudeSettings } from "@/features/settings/ClaudeSettings";
import { McpSettings } from "@/features/settings/McpSettings";
import { VoiceSelect } from "@/features/voice/VoiceSelect";

type CategoryId = "deps" | "claude" | "mcp" | "folders" | "keys" | "prefs";

export function SettingsPage() {
  const health = useHealth();
  const refresh = useRefreshDependencies();
  const saved = useSettings();
  const save = useSaveSettings();

  const [category, setCategory] = useState<CategoryId>("deps");
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const current = draft ?? saved.data;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved.data);

  const deps = health.data?.dependencies ?? [];
  const required = deps.filter((d) => d.required);
  const missingRequired = required.filter((d) => !d.ok).length;
  const keysConfigured = current ? KEYED_PROVIDERS.filter((k) => current.api_keys[k.id]).length : 0;

  const update = (patch: Partial<AppSettings>) => current && setDraft({ ...current, ...patch });

  const categories: { id: CategoryId; icon: LucideIcon; title: string; subtitle: string; value?: React.ReactNode }[] = [
    {
      id: "deps",
      icon: Wrench,
      title: "Dependencias",
      subtitle: `${deps.filter((d) => d.ok).length}/${deps.length} disponibles`,
      value: missingRequired > 0 ? `${missingRequired} faltan` : deps.length ? "OK" : "…",
    },
    {
      id: "claude",
      icon: Sparkles,
      title: "Claude",
      subtitle: current?.claude_model ? `Modelo: ${current.claude_model}` : "Modelo y prompts",
    },
    { id: "mcp", icon: Plug, title: "Conexión MCP", subtitle: "Usar Guionaria desde Claude" },
    { id: "folders", icon: FolderOpen, title: "Carpetas", subtitle: "Datos, base de datos y ajustes" },
    {
      id: "keys",
      icon: KeyRound,
      title: "Claves de API",
      subtitle: "Fotos, videos y sonido",
      value: `${keysConfigured}/${KEYED_PROVIDERS.length}`,
    },
    {
      id: "prefs",
      icon: SlidersHorizontal,
      title: "Preferencias",
      subtitle: "Voz, transcripción, descargas y tema",
    },
  ];
  const active = categories.find((c) => c.id === category)!;

  return (
    <PageLayout
      title="Ajustes"
      actions={
        <Button
          variant="outline"
          className="h-10 bg-panel"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || health.isError}
        >
          <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
          Verificar de nuevo
        </Button>
      }
      bottomBar={
        <BottomBar
          stats={[
            {
              label: "Dependencias requeridas",
              value: `${required.length - missingRequired}/${required.length}`,
              highlight: true,
            },
            { label: "Cambios", value: dirty ? "Sin guardar" : "Guardados" },
          ]}
        >
          {save.isError && <span className="text-[12px] text-danger">No se pudo guardar</span>}
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          )}
          <Button
            size="lg"
            className="min-w-36"
            disabled={!dirty || save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}
          >
            Guardar ajustes
          </Button>
        </BottomBar>
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* Lista de categorías (referencia 01, columna central) */}
        <div className="w-72 shrink-0 overflow-y-auto border-r p-2">
          {categories.map((c) => {
            const isActive = c.id === category;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors",
                  isActive
                    ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                    : "hover:bg-panel-2/60",
                )}
              >
                <c.icon className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{c.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{c.subtitle}</span>
                </span>
                {c.value && (
                  <span
                    className={cn(
                      "text-[12px]",
                      isActive ? "text-brand" : "text-muted-foreground",
                      c.id === "deps" && missingRequired > 0 && "text-danger",
                    )}
                  >
                    {c.value}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Detalle */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center border-b px-5">
            <span className="text-[13px] font-medium">{active.title}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">{active.subtitle}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {category === "deps" &&
              (health.isError ? (
                <p className="p-5 text-[13px] text-muted-foreground">
                  Sin conexión con el núcleo: no se pueden verificar las dependencias.
                </p>
              ) : (
                deps.map((dep) => <DependencyRow key={dep.name} dep={dep} />)
              ))}

            {category === "folders" && health.data && (
              <div className="divide-y">
                <PathRow label="Carpeta de datos" value={health.data.home} />
                <PathRow label="Base de datos" value={`${health.data.home}\\guionaria.db`} />
                <PathRow label="Ajustes y claves" value={`${health.data.home}\\config\\settings.json`} />
                <p className="px-5 py-4 text-[12px] text-muted-foreground">
                  Para usar otra carpeta, define la variable de entorno{" "}
                  <code className="selectable font-mono">GUIONARIA_HOME</code> y reinicia la app.
                </p>
              </div>
            )}

            {category === "keys" && current && (
              <ApiKeysSettings settings={current} saved={saved.data} onChange={update} />
            )}

            {category === "claude" && current && (
              <ClaudeSettings settings={current} onChange={update} />
            )}

            {category === "mcp" && <McpSettings />}

            {category === "prefs" && current && (
              <div className="grid max-w-xl gap-5 p-5">
                <Field
                  label="Voz por defecto"
                  hint="Voz de Piper para los canales sin voz propia. Se descarga la primera vez que se usa."
                >
                  <VoiceSelect
                    value={current.tts_voice || null}
                    onChange={(v) => update({ tts_voice: v })}
                    placeholder="es_MX-claude-high (recomendada)"
                  />
                </Field>
                <Field label="Modelo de Whisper" hint="small es rápido en CPU; medium es más preciso.">
                  <Select value={current.whisper_model} onValueChange={(v) => update({ whisper_model: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["tiny", "base", "small", "medium"].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Descargas en paralelo" hint="Entre 1 y 16.">
                  <Input
                    type="number"
                    min={1}
                    max={16}
                    value={current.download_parallelism}
                    onChange={(e) => update({ download_parallelism: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Tema">
                  <Select
                    value={current.theme}
                    onValueChange={(v) => update({ theme: v as AppSettings["theme"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Oscuro</SelectItem>
                      <SelectItem value="light">Claro</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

function DependencyRow({ dep }: { dep: DependencyStatus }) {
  const StatusIcon = dep.ok ? CircleCheck : dep.required ? CircleX : CircleAlert;
  return (
    <div className="flex items-center gap-4 border-b px-5 py-3.5 last:border-b-0">
      <StatusIcon
        className={cn(
          "size-5 shrink-0",
          dep.ok ? "text-success-foreground" : dep.required ? "text-danger" : "text-warning",
        )}
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{dep.label}</span>
          <span
            className={cn(
              "rounded px-1.5 py-px text-[10px] font-medium",
              dep.required ? "bg-active text-active-foreground" : "bg-panel-2 text-muted-foreground",
            )}
          >
            {dep.required ? "Requerida" : "Opcional"}
          </span>
        </div>
        <div className="selectable truncate text-[12px] text-muted-foreground">
          {dep.ok ? dep.version : dep.detail}
        </div>
      </div>
      {dep.ok ? (
        <span className="selectable max-w-[45%] truncate font-mono text-[11px] text-subtle" title={dep.path ?? ""}>
          {dep.path}
        </span>
      ) : (
        <CopyCommand command={dep.install_hint} />
      )}
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-[55%] items-center gap-1 rounded-md bg-background py-1 pr-1 pl-3">
      <code className="selectable truncate font-mono text-[11px] text-muted-foreground" title={command}>
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copiar comando"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="text-success-foreground" /> : <Copy />}
      </Button>
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <span className="w-40 shrink-0 text-[13px]">{label}</span>
      <code className="selectable truncate font-mono text-[12px] text-muted-foreground">{value}</code>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
