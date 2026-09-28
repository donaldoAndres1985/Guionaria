import { ArrowRight, CalendarClock, Lightbulb, Plus, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge } from "@/components/projects/badges";
import { Button } from "@/components/ui/button";
import { useChannels } from "@/hooks/useChannels";
import { useHealth, useSettings } from "@/hooks/useCore";
import { useIdeas } from "@/hooks/useIdeas";
import { useLibraryStats } from "@/hooks/useLibrary";
import { useMcpInfo } from "@/hooks/useMcp";
import { useProjects } from "@/hooks/useProjects";
import type { ApiKeys, Project } from "@/lib/api";
import { currentStage, formatDate, isThisMonth, STAGES, STATUS_ORDER } from "@/lib/project";
import { formatSize } from "@/features/storage/treemap";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** Pendientes primero por fecha objetivo (los sin fecha al final) y luego por prioridad. */
function byUrgency(a: Project, b: Project) {
  const da = a.target_publish_at ?? "9999";
  const db = b.target_publish_at ?? "9999";
  return da.localeCompare(db) || a.priority - b.priority;
}

const reached = (p: Project, status: Project["status"]) => STATUS_ORDER.indexOf(p.status) >= STATUS_ORDER.indexOf(status);

/** Qué hace Guionaria en cada etapa (se muestra cuando la etapa no tiene proyectos). */
const STAGE_PITCH: Record<string, string> = {
  guion: "Claude redacta el guion con tus notas y marca los datos por verificar.",
  escenas: "Cada frase se vuelve una escena con búsqueda, efecto y texto en pantalla.",
  medios: "Fotos y videos de siete fuentes y de tu biblioteca, en la orientación correcta.",
  voz: "Voz con Piper o ElevenLabs y subtítulos sincronizados palabra por palabra.",
  timeline: "Vista previa en vivo, tramo exacto de cada clip y render hasta 4K.",
  publicacion: "Calendario, créditos de cada medio y el video listo para subir.",
};

/** Qué toca hacer en la etapa en curso (tarjeta «Continuar»). */
const NEXT_STEP: Record<string, string> = {
  guion: "Genera o escribe el guion y apruébalo.",
  escenas: "Revisa la tabla de escenas y apruébala.",
  medios: "Elige un medio por escena y pulsa «Descargar y aprobar».",
  voz: "Genera la voz: los subtítulos salen solos.",
  timeline: "Revisa la vista previa y renderiza.",
  publicacion: "Programa la fecha y sube el video con sus créditos.",
};

const HEADLINE = ["De", "una", "idea", "a", "un", "video", "listo."];

export function HomePage() {
  const navigate = useNavigate();
  const { data: health } = useHealth();
  const { data: settings } = useSettings();
  const { data: mcp } = useMcpInfo();
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [] } = useProjects({ channel: channel?.id });
  const { data: ideas = [] } = useIdeas({ channel: channel?.id, status: "open" });
  const { data: library } = useLibraryStats();

  const active = projects.filter((p) => p.status !== "PUBLICADO").sort(byUrgency);
  const next = active[0] ?? null;
  const dueThisMonth = active.filter((p) => isThisMonth(p.target_publish_at));
  const rendered = projects.filter((p) => reached(p, "RENDERIZADO"));
  const published = projects.filter((p) => p.status === "PUBLICADO");
  const missingRequired = health?.dependencies.filter((d) => d.required && !d.ok) ?? [];
  const newProject = () => navigate(channels.length ? "/proyectos?nuevo=1" : "/canales?nuevo=1");

  return (
    <PageLayout
      title="Inicio"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Proyectos activos", value: active.length },
            { label: "Por publicar este mes", value: dueThisMonth.length, highlight: true },
          ]}
        >
          <Button size="lg" onClick={newProject}>
            <Plus />
            Nuevo proyecto
          </Button>
        </BottomBar>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {missingRequired.length > 0 && (
          <Link
            to="/ajustes"
            className="flex items-center gap-2 border-b px-6 py-2.5 text-[12px] text-warning hover:bg-panel-2"
          >
            Faltan {missingRequired.length} dependencias requeridas ({missingRequired.map((d) => d.label).join(", ")}) ·
            Revisar en Ajustes
          </Link>
        )}

        <div className="mx-auto grid max-w-[1400px] gap-6 p-6">
          {/* Portada: el producto se presenta con su propio subtítulo */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex items-center gap-8 overflow-hidden rounded-xl border bg-panel p-6 lg:p-8">
              <CaptionMonitor />
              <div className="min-w-0">
                <p className="text-[12px] tracking-wide text-muted-foreground">Guionaria · estudio de video para tus canales</p>
                <h2
                  className="mt-3 text-[40px] leading-[1.05] text-foreground xl:text-[48px]"
                  style={{ fontFamily: '"Montserrat", sans-serif', fontWeight: 800, fontStyle: "italic" }}
                >
                  De una idea a un video listo.
                </h2>
                <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
                  Claude escribe el guion, Guionaria arma las escenas, busca los medios, pone la voz con subtítulos y
                  renderiza. Tú revisas cada paso y decides.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button size="lg" onClick={newProject}>
                    <Plus /> {channels.length ? "Nuevo proyecto" : "Crear mi primer canal"}
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/ideas">
                      <Lightbulb /> Banco de ideas{ideas.length ? ` (${ideas.length})` : ""}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <NextUp project={next} onOpen={(p) => navigate(`/proyectos/${p.id}`)} />
          </section>

          {/* Línea de producción: cada proyecto en su etapa */}
          <section aria-labelledby="linea" className="rounded-xl border bg-panel">
            <div className="flex items-baseline gap-3 border-b px-5 py-3">
              <h3 id="linea" className="text-[13px] font-semibold">
                Línea de producción
              </h3>
              <span className="text-[12px] text-muted-foreground">
                {active.length ? `${active.length} en curso${channel ? ` · ${channel.name}` : ""}` : "Sin proyectos en curso"}
              </span>
              <Link to="/proyectos" className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">
                Ver todos
              </Link>
            </div>
            <ol className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              {STAGES.map((stage) => {
                const here = active.filter((p) => currentStage(p.status)?.id === stage.id);
                return (
                  <li
                    key={stage.id}
                    className="relative flex min-h-40 flex-col gap-2 border-b p-4 md:border-r xl:border-b-0 xl:last:border-r-0"
                    data-testid={`stage-${stage.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <stage.icon className={cn("size-4", here.length ? "text-brand" : "text-subtle")} strokeWidth={1.8} />
                      <span className="text-[13px] font-medium">{stage.label}</span>
                      <span className="ml-auto font-mono text-[12px] text-muted-foreground">{here.length}</span>
                    </div>
                    {here.length ? (
                      <div className="grid gap-1.5">
                        {here.slice(0, 4).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => navigate(`/proyectos/${p.id}`)}
                            className="rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:border-brand/60"
                          >
                            <span className="line-clamp-2 text-[12px] leading-snug font-medium">{p.title}</span>
                            <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <FormatBadge format={p.format} />
                              {p.target_publish_at && (
                                <span className={cn(isThisMonth(p.target_publish_at) && "text-brand")}>
                                  {formatDate(p.target_publish_at)}
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                        {here.length > 4 && (
                          <Link to="/proyectos" className="text-[11px] text-muted-foreground hover:text-foreground">
                            y {here.length - 4} más
                          </Link>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-subtle">{STAGE_PITCH[stage.id]}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            {/* Cifras reales del estudio */}
            <div className="rounded-xl border bg-panel p-5" aria-labelledby="estudio">
              <h3 id="estudio" className="text-[13px] font-semibold">
                Tu estudio
              </h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-5">
                <Fact label="En producción" value={active.length} />
                <Fact label="Renderizados" value={rendered.length} />
                <Fact label="Publicados" value={published.length} />
                <Fact label="Ideas en el banco" value={ideas.length} to="/ideas" />
                <Fact
                  label="Medios en la biblioteca"
                  value={library?.assets ?? 0}
                  hint={library?.saved_bytes ? `${formatSize(library.saved_bytes)} ahorrados al reutilizar` : undefined}
                  to="/medios"
                />
              </dl>
            </div>

            {/* Qué está conectado */}
            <Connections
              deps={health?.dependencies ?? []}
              keys={settings?.api_keys}
              mcpRegistered={mcp?.claude_code_registered ?? null}
            />
          </section>

          {/* Qué incluye (para quien la conoce por primera vez) */}
          <section aria-labelledby="incluye" className="rounded-xl border bg-panel p-5">
            <h3 id="incluye" className="text-[13px] font-semibold">
              Qué incluye Guionaria
            </h3>
            <ul className="mt-4 grid gap-x-8 gap-y-4 text-[13px] md:grid-cols-2 xl:grid-cols-4">
              <Feature title="Guion y escenas con Claude">
                Guion por segmentos con versiones, reescritura de fragmentos y escenas con búsquedas listas.
              </Feature>
              <Feature title="Medios sin salir de la app">
                Pexels, Pixabay, Unsplash, Openverse, Wikimedia, SearXNG y videos desde URL, con créditos automáticos.
              </Feature>
              <Feature title="Voz y subtítulos de reel">
                Piper gratis o ElevenLabs; subtítulos con la palabra resaltada, cursiva, sombra y efecto pop.
              </Feature>
              <Feature title="Del timeline al MP4">
                Vista previa en vivo, tramo exacto de cada clip, render hasta 4K y exportación a DaVinci Resolve.
              </Feature>
            </ul>
            <p className="mt-5 text-[12px] text-subtle">
              Todo corre en tu equipo; también puedes pedirle a Claude que lo haga por ti desde Claude Code o Claude
              Desktop.
            </p>
          </section>
        </div>
      </div>
    </PageLayout>
  );
}

/**
 * Monitor 9:16 con el titular quemado como un subtítulo de reel: la palabra que «se dice» avanza
 * en amarillo, igual que en los videos que produce Guionaria.
 */
function CaptionMonitor() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActive(5); // «video» resaltado, sin animación
      return;
    }
    const id = window.setInterval(() => setActive((i) => (i + 1) % HEADLINE.length), 420);
    return () => window.clearInterval(id);
  }, []);
  // Frases de tres palabras, como en los subtítulos de un reel.
  const group = Math.floor(active / 3);
  const words = HEADLINE.slice(group * 3, group * 3 + 3);
  return (
    <div
      aria-hidden
      data-testid="caption-monitor"
      className="relative hidden h-[260px] w-[146px] shrink-0 overflow-hidden rounded-lg border bg-[linear-gradient(170deg,#3a3129,#15110f_70%)] shadow-[0_20px_60px_-20px_rgba(255,122,26,0.35)] sm:block"
    >
      {/* Horizonte tenue: sugiere una toma sin competir con el subtítulo */}
      <div className="absolute inset-x-0 top-[38%] h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
      <span className="absolute top-2 left-2 font-mono text-[9px] text-white/70">
        00:{String(active * 4).padStart(2, "0")}.{active % 10}
      </span>
      <span className="absolute top-2 right-2 flex items-center gap-1 font-mono text-[9px] text-white/70">
        <span className="size-1.5 rounded-full bg-brand" /> 9:16
      </span>
      <div className="absolute inset-x-2 bottom-[22%] text-center">
        <span
          className="text-[15px] leading-tight text-white"
          style={{
            fontFamily: '"Montserrat", sans-serif',
            fontWeight: 800,
            fontStyle: "italic",
            textShadow: "0 3px 6px rgba(0,0,0,0.8)",
          }}
        >
          {words.map((w, i) => (
            <span key={`${group}-${w}`} style={group * 3 + i === active ? { color: "#FFD400" } : undefined}>
              {w.toUpperCase()}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function NextUp({ project, onOpen }: { project: Project | null; onOpen: (p: Project) => void }) {
  if (!project) {
    return (
      <div className="flex flex-col justify-center gap-2 rounded-xl border border-dashed p-6 text-[13px]">
        <p className="font-medium">No hay nada en curso</p>
        <p className="text-muted-foreground">Crea un proyecto o convierte una idea del banco para empezar.</p>
      </div>
    );
  }
  const stage = currentStage(project.status);
  const done = STAGES.filter((s) => STATUS_ORDER.indexOf(project.status) >= STATUS_ORDER.indexOf(s.doneFrom)).length;
  return (
    <div className="flex flex-col gap-0 rounded-xl border bg-panel p-5 [&>button]:mt-6" data-testid="next-up">
      <p className="text-[12px] text-muted-foreground">Continuar</p>
      <h3 className="mt-1.5 line-clamp-2 text-[16px] leading-snug font-semibold">{project.title}</h3>
      <p className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
        <FormatBadge format={project.format} /> {project.channel_name}
      </p>
      <div className="mt-5">
        <div className="flex items-baseline justify-between text-[12px]">
          <span>
            Etapa: <span className="font-medium text-foreground">{stage?.label ?? "Publicado"}</span>
          </span>
          <span className="font-mono text-muted-foreground">
            {done}/{STAGES.length}
          </span>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {STAGES.map((s, i) => (
            <span
              key={s.id}
              className={cn("h-1.5 flex-1 rounded-full", i < done ? "bg-brand" : i === done ? "bg-brand/40" : "bg-panel-2")}
            />
          ))}
        </div>
      </div>
      {stage && <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{NEXT_STEP[stage.id]}</p>}
      {project.target_publish_at && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-[12px]",
            isThisMonth(project.target_publish_at) ? "text-brand" : "text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3.5" /> Publicación: {formatDate(project.target_publish_at)}
        </p>
      )}
      <Button className="mt-auto self-start" onClick={() => onOpen(project)}>
        Seguir con {stage?.label.toLowerCase() ?? "el proyecto"} <ArrowRight />
      </Button>
    </div>
  );
}

function Fact({ label, value, hint, to }: { label: string; value: number; hint?: string; to?: string }) {
  const body = (
    <>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-[26px] leading-none font-semibold">{value}</dd>
      {hint && <dd className="mt-1.5 text-[11px] text-subtle">{hint}</dd>}
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-md hover:bg-panel-2/60">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{children}</p>
    </li>
  );
}

function Connections({
  deps,
  keys,
  mcpRegistered,
}: {
  deps: { name: string; label: string; ok: boolean; required: boolean }[];
  keys: ApiKeys | undefined;
  mcpRegistered: boolean | null;
}) {
  const sources = [
    ["pexels", "Pexels"],
    ["pixabay", "Pixabay"],
    ["unsplash", "Unsplash"],
    ["freesound", "Freesound"],
    ["elevenlabs", "ElevenLabs"],
  ] as const;
  const items = [
    ...deps.map((d) => ({ label: d.label, ok: d.ok, required: d.required })),
    ...sources.map(([id, label]) => ({ label, ok: !!keys?.[id], required: false })),
    { label: "Claude por MCP", ok: !!mcpRegistered, required: false },
  ];
  const ready = items.filter((i) => i.ok).length;
  return (
    <div className="rounded-xl border bg-panel p-5" aria-labelledby="conexiones">
      <div className="flex items-baseline gap-2">
        <h3 id="conexiones" className="text-[13px] font-semibold">
          Conexiones
        </h3>
        <span className="font-mono text-[12px] text-muted-foreground">
          {ready}/{items.length}
        </span>
        <Link to="/ajustes" className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
          <Settings2 className="size-3.5" /> Ajustes
        </Link>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li
            key={i.label}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
              i.ok ? "text-foreground" : i.required ? "border-danger/40 text-danger" : "text-subtle",
            )}
          >
            <span className={cn("size-1.5 rounded-full", i.ok ? "bg-success-foreground" : i.required ? "bg-danger" : "bg-subtle/50")} />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
