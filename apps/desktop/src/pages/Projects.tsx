import { Clapperboard, FileVideo, LayoutGrid, List, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge, StatusBadge } from "@/components/projects/badges";
import { PublishBadges } from "@/features/publishing/PublishBadges";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { ImportVideoDialog } from "@/components/projects/ImportVideoDialog";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { ProjectMenu } from "@/components/projects/ProjectMenu";
import { MediaStrip, ProjectCover } from "@/components/projects/ProjectThumbs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useChannels } from "@/hooks/useChannels";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/lib/api";
import {
  currentStage,
  formatDate,
  formatDuration,
  isThisMonth,
  STAGES,
  type StageId,
} from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

type TabId = "all" | StageId | "published";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "Todos" },
  ...STAGES.map((s) => ({ id: s.id as TabId, label: s.label })),
  { id: "published", label: "Publicados" },
];

function tabOf(p: Project): TabId {
  return currentStage(p.status)?.id ?? "published";
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dialogOpen = params.get("nuevo") === "1";
  const setDialogOpen = (open: boolean) => setParams(open ? { nuevo: "1" } : {});

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const view = useUiStore((s) => s.projectsView);
  const setView = useUiStore((s) => s.setProjectsView);
  const showPublished = useUiStore((s) => s.showPublished);
  const setShowPublished = useUiStore((s) => s.setShowPublished);
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [], isPending } = useProjects({ channel: channel?.id, q: query });

  // Sin «Mostrar publicados», «Todos» deja fuera los publicados (la pestaña Publicados sí los muestra).
  const pending = showPublished ? projects : projects.filter((p) => tabOf(p) !== "published");
  const counts = new Map<TabId, number>([["all", pending.length]]);
  for (const p of projects) counts.set(tabOf(p), (counts.get(tabOf(p)) ?? 0) + 1);
  const visible = tab === "all" ? pending : projects.filter((p) => tabOf(p) === tab);
  const allPublished = tab === "all" && !showPublished && projects.length > 0 && pending.length === 0;
  const thisMonth = projects.filter((p) => isThisMonth(p.target_publish_at) && p.status !== "PUBLICADO");

  const newButton = (
    <Button size="lg" onClick={() => setDialogOpen(true)}>
      <Plus />
      Nuevo proyecto
    </Button>
  );

  return (
    <PageLayout
      title="Proyectos"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Proyectos", value: projects.length },
            { label: "Por publicar este mes", value: thisMonth.length, highlight: true },
          ]}
        >
          <Button size="lg" variant="outline" onClick={() => setImporting(true)} title="Un video ya editado en CapCut u otro editor">
            <FileVideo /> Importar video terminado
          </Button>
          {newButton}
        </BottomBar>
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-3 text-[13px] transition-colors",
              tab === t.id
                ? "bg-active font-medium text-active-foreground"
                : "text-muted-foreground hover:bg-panel-2 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-[11px] opacity-80">{counts.get(t.id) ?? 0}</span>
          </button>
        ))}
        <label
          className="ml-auto flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground select-none hover:text-foreground"
          title="Sin marcar, «Todos» muestra solo los proyectos sin publicar"
        >
          <Checkbox checked={showPublished} onCheckedChange={(v) => setShowPublished(v === true)} aria-label="Mostrar publicados" />
          Mostrar publicados
        </label>
        <div role="radiogroup" aria-label="Vista" className="flex rounded-md border p-0.5">
          {(
            [
              ["list", List, "Lista"],
              ["grid", LayoutGrid, "Miniaturas"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={view === id}
              aria-label={label}
              title={label}
              onClick={() => setView(id)}
              className={cn("rounded px-2 py-1", view === id ? "bg-active text-active-foreground" : "text-muted-foreground hover:bg-panel-2")}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
        <label className="flex h-8 w-56 items-center gap-2 rounded-md border bg-background px-2.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, tema o etiqueta"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      {!isPending && visible.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title={query ? "Sin resultados" : allPublished ? "Todo está publicado" : "Sin proyectos todavía"}
          description={
            query
              ? `Ningún proyecto coincide con "${query}".`
              : allPublished
                ? "Marca «Mostrar publicados» para verlos, o crea un proyecto nuevo."
                : "Crea un video (16:9) o un reel (9:16) y avanza por guion, escenas, medios, voz y timeline."
          }
          action={!query && tab === "all" ? newButton : undefined}
        />
      ) : view === "grid" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="projects-grid">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {visible.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Abrir ${p.title}`}
                onClick={() => navigate(`/proyectos/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/proyectos/${p.id}`);
                }}
                className="group relative grid cursor-pointer content-start gap-2 rounded-lg border p-2.5 transition-colors hover:border-brand/60 hover:bg-panel-2"
              >
                <ProjectCover project={p} className={p.format === "reel" ? "mx-auto h-64" : "w-full"} />
                <div className="grid gap-1">
                  <span className="line-clamp-2 text-[13px] leading-snug font-medium">{p.title}</span>
                  <span className="flex items-center gap-2 truncate text-[11px] text-muted-foreground">
                    {p.channel_name} · {formatDuration(p.target_duration_s)}
                    {p.origin === "importado" && <ImportedBadge />}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={p.status} />
                    <PublishBadges project={p} />
                  </span>
                  <MediaStrip project={p} />
                </div>
                <ProjectMenu project={p} onDelete={() => setToDelete(p)} className="absolute top-3.5 right-3.5 bg-background/80" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[12px] text-muted-foreground">
              <tr className="border-b">
                <th className="py-2.5 pr-3 pl-5 font-normal">Título</th>
                <th className="w-44 px-3 font-normal">Canal</th>
                <th className="w-44 px-3 font-normal">Estado</th>
                <th className="w-24 px-3 font-normal">Duración</th>
                <th className="w-32 px-3 font-normal">Publicación</th>
                <th className="w-32 px-3 font-normal">Actualizado</th>
                <th className="w-12 pr-3" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/proyectos/${p.id}`)}
                  className="group cursor-pointer border-b last:border-b-0 hover:bg-panel-2"
                >
                  <td className="py-3 pr-3 pl-5">
                    <div className="flex items-center gap-3">
                    <ProjectCover project={p} className={cn("shrink-0", p.format === "reel" ? "h-14" : "h-10")} />
                    <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <FormatBadge format={p.format} />
                      {p.origin === "importado" && <ImportedBadge />}
                      {p.topic && (
                        <span className="truncate text-[12px] text-muted-foreground">{p.topic}</span>
                      )}
                    </div>
                    </div>
                    </div>
                  </td>
                  <td className="truncate px-3 text-muted-foreground">{p.channel_name}</td>
                  <td className="px-3">
                    <span className="flex flex-col items-start gap-1">
                      <StatusBadge status={p.status} />
                      <PublishBadges project={p} />
                    </span>
                  </td>
                  <td className="px-3 font-mono text-[12px]">{formatDuration(p.target_duration_s)}</td>
                  <td
                    className={cn(
                      "px-3 text-[12px]",
                      isThisMonth(p.target_publish_at) ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    {formatDate(p.target_publish_at)}
                  </td>
                  <td className="px-3 text-[12px] text-muted-foreground">
                    {formatDate(p.updated_at)}
                  </td>
                  <td className="pr-3">
                    <ProjectMenu project={p} onDelete={() => setToDelete(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportVideoDialog open={importing} onOpenChange={setImporting} />
      {toDelete && (
        <DeleteProjectDialog project={toDelete} open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)} />
      )}
    </PageLayout>
  );
}

function ImportedBadge() {
  return (
    <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Video terminado en otro editor (CapCut…)">
      Importado
    </span>
  );
}
