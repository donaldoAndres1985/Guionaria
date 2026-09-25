import { CalendarClock, Clapperboard, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge, StatusBadge } from "@/components/projects/badges";
import { Button } from "@/components/ui/button";
import { useChannels } from "@/hooks/useChannels";
import { useHealth } from "@/hooks/useCore";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/lib/api";
import { currentStage, formatDate, isThisMonth } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** Pendientes primero por fecha objetivo (los sin fecha al final) y luego por prioridad. */
function byUrgency(a: Project, b: Project) {
  const da = a.target_publish_at ?? "9999";
  const db = b.target_publish_at ?? "9999";
  return da.localeCompare(db) || a.priority - b.priority;
}

export function HomePage() {
  const navigate = useNavigate();
  const { data: health } = useHealth();
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [], isPending } = useProjects({ channel: channel?.id });

  const active = projects.filter((p) => p.status !== "PUBLICADO").sort(byUrgency);
  const dueThisMonth = active.filter((p) => isThisMonth(p.target_publish_at));
  const missingRequired = health?.dependencies.filter((d) => d.required && !d.ok) ?? [];
  const newProject = () => navigate("/proyectos?nuevo=1");

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
      {missingRequired.length > 0 && (
        <Link
          to="/ajustes"
          className="flex items-center gap-2 border-b px-5 py-2.5 text-[12px] text-warning hover:bg-panel-2"
        >
          Faltan {missingRequired.length} dependencias requeridas (
          {missingRequired.map((d) => d.label).join(", ")}) · Revisar en Ajustes
        </Link>
      )}

      {!isPending && active.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title={channels.length ? "Sin proyectos pendientes" : "Empieza creando un canal"}
          description={
            channels.length
              ? "Aquí verás lo pendiente de cada canal, ordenado por fecha de publicación."
              : "Cada proyecto pertenece a un canal con su tono, plataformas y velocidad de narración."
          }
          action={
            channels.length ? (
              <Button onClick={newProject}>
                <Plus />
                Nuevo proyecto
              </Button>
            ) : (
              <Button asChild>
                <Link to="/canales?nuevo=1">Crear canal</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-11 items-center border-b px-5 text-[13px] font-medium">
            Pendientes
            <span className="ml-auto text-[12px] font-normal text-muted-foreground">
              Ordenados por publicación objetivo
            </span>
          </div>
          {active.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/proyectos/${p.id}`)}
              className="flex w-full items-center gap-4 border-b px-5 py-3 text-left last:border-b-0 hover:bg-panel-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{p.title}</div>
                <div className="mt-0.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                  <FormatBadge format={p.format} />
                  <span>{p.channel_name}</span>
                  <span>· {currentStage(p.status)?.label}</span>
                </div>
              </div>
              <StatusBadge status={p.status} />
              <span
                className={cn(
                  "flex w-32 items-center justify-end gap-1.5 text-[12px]",
                  isThisMonth(p.target_publish_at) ? "text-brand" : "text-muted-foreground",
                )}
              >
                <CalendarClock className="size-3.5" />
                {formatDate(p.target_publish_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
