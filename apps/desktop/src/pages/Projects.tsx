import { Clapperboard, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge, StatusBadge } from "@/components/projects/badges";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { Button } from "@/components/ui/button";
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
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [], isPending } = useProjects({ channel: channel?.id, q: query });

  const counts = new Map<TabId, number>([["all", projects.length]]);
  for (const p of projects) counts.set(tabOf(p), (counts.get(tabOf(p)) ?? 0) + 1);
  const visible = tab === "all" ? projects : projects.filter((p) => tabOf(p) === tab);
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
        <label className="ml-auto flex h-8 w-56 items-center gap-2 rounded-md border bg-background px-2.5">
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
          title={query ? "Sin resultados" : "Sin proyectos todavía"}
          description={
            query
              ? `Ningún proyecto coincide con "${query}".`
              : "Crea un video (16:9) o un reel (9:16) y avanza por guion, escenas, medios, voz y timeline."
          }
          action={!query && tab === "all" ? newButton : undefined}
        />
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
                <th className="w-32 px-3 pr-5 font-normal">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/proyectos/${p.id}`)}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-panel-2"
                >
                  <td className="py-3 pr-3 pl-5">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <FormatBadge format={p.format} />
                      {p.topic && (
                        <span className="truncate text-[12px] text-muted-foreground">{p.topic}</span>
                      )}
                    </div>
                  </td>
                  <td className="truncate px-3 text-muted-foreground">{p.channel_name}</td>
                  <td className="px-3">
                    <StatusBadge status={p.status} />
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
                  <td className="px-3 pr-5 text-[12px] text-muted-foreground">
                    {formatDate(p.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </PageLayout>
  );
}
