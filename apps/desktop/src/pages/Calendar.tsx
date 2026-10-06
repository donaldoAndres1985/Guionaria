import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CircleCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge } from "@/components/projects/badges";
import { Button } from "@/components/ui/button";
import {
  addDays,
  byDate,
  COLUMNS,
  columnOf,
  dropAction,
  isoDate,
  monthGrid,
  MONTHS,
  publishedLinks,
  publishedOn,
  weekDays,
  WEEKDAYS,
} from "@/features/planning/calendarMeta";
import { useChannels } from "@/hooks/useChannels";
import { PLATFORM_LABEL } from "@/components/projects/ProjectMenu";
import { PLATFORM_TONE } from "@/features/publishing/publishingMeta";
import { useProjects, useRescheduleProject, useSetProjectStatus } from "@/hooks/useProjects";
import type { Project, PublishPlatform } from "@/lib/api";
import { isThisMonth, STATUS_LABEL } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

type View = "month" | "week" | "board";

const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "Mes" },
  { id: "week", label: "Semana" },
  { id: "board", label: "Tablero" },
];

export function CalendarPage() {
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [] } = useProjects({ channel: channel?.id });
  const reschedule = useRescheduleProject();
  const setStatus = useSetProjectStatus();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  // Distancia mínima: un clic abre el proyecto; arrastrar lo mueve.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const project = projects.find((p) => `project-${p.id}` === active.id);
    if (!project) return;
    const action = dropAction(project, String(over.id));
    if (action?.kind === "reschedule") {
      reschedule.mutate(
        { id: project.id, date: action.date },
        {
          onSuccess: () =>
            toast.success(action.date ? `«${project.title}» se publica el ${action.date}` : "Sin fecha de publicación"),
        },
      );
    } else if (action?.kind === "status") {
      setStatus.mutate({ id: project.id, status: action.status });
    } else if (action?.kind === "published") {
      toast.info("Ya está publicado: aparece el día en que guardaste su enlace");
    } else if (action?.kind === "blocked") {
      toast.info("Las etapas de producción avanzan aprobando cada una dentro del proyecto");
    }
  };

  const step = (dir: number) =>
    setCursor((c) =>
      view === "week" ? addDays(c, dir * 7) : new Date(c.getFullYear(), c.getMonth() + dir, 1),
    );
  const undated = projects.filter((p) => !p.target_publish_at && p.status !== "PUBLICADO" && !publishedOn(p));
  const monthKey = isoDate(new Date()).slice(0, 7);
  const publishedThisMonth = projects.filter((p) => publishedOn(p)?.startsWith(monthKey)).length;
  const title =
    view === "week"
      ? (() => {
          const days = weekDays(cursor);
          return `${days[0].getDate()} ${MONTHS[days[0].getMonth()]} – ${days[6].getDate()} ${MONTHS[days[6].getMonth()]}`;
        })()
      : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <PageLayout
      title="Calendario"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Este mes", value: projects.filter((p) => isThisMonth(p.target_publish_at)).length, highlight: true },
            { label: "Sin fecha", value: undated.length },
            { label: "Publicados este mes", value: publishedThisMonth },
          ]}
        />
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={cn(
              "rounded px-3 py-1.5 text-[13px]",
              view === v.id ? "bg-panel-2 font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
        {view !== "board" && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground" data-testid="calendar-legend">
            <span className="flex items-center gap-1">
              <CircleCheck className="size-3.5 text-success-foreground" /> Publicado (fecha del enlace)
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm border border-muted-foreground/60" /> Previsto
            </span>
          </div>
        )}
        {view !== "board" && (
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Anterior" onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
            <span className="w-52 text-center text-[13px] font-medium capitalize">{title}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Siguiente" onClick={() => step(1)}>
              <ChevronRight />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>
              Hoy
            </Button>
          </div>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === "board" ? (
          <Board projects={projects} />
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto p-3">
              {view === "month" ? <Month cursor={cursor} projects={projects} /> : <Week cursor={cursor} projects={projects} />}
            </div>
            <Undated projects={undated} />
          </div>
        )}
      </DndContext>
    </PageLayout>
  );
}

function Month({ cursor, projects }: { cursor: Date; projects: Project[] }) {
  const grouped = byDate(projects);
  const today = isoDate(new Date());
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-md border" data-testid="month-grid">
      {WEEKDAYS.map((d) => (
        <div key={d} className="border-b bg-panel px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {monthGrid(cursor.getFullYear(), cursor.getMonth()).map((day) => {
        const key = isoDate(day);
        return (
          <DayCell key={key} date={key} muted={day.getMonth() !== cursor.getMonth()} today={key === today} className="min-h-24">
            <span className="text-[11px] text-muted-foreground">{day.getDate()}</span>
            {(grouped.get(key) ?? []).map((p) => (
              <Chip key={p.id} project={p} />
            ))}
          </DayCell>
        );
      })}
    </div>
  );
}

function Week({ cursor, projects }: { cursor: Date; projects: Project[] }) {
  const grouped = byDate(projects);
  const today = isoDate(new Date());
  return (
    <div className="grid h-full grid-cols-7 overflow-hidden rounded-md border" data-testid="week-grid">
      {weekDays(cursor).map((day, i) => {
        const key = isoDate(day);
        return (
          <DayCell key={key} date={key} today={key === today} className="min-h-80">
            <span className="text-[12px] font-medium">
              {WEEKDAYS[i]} <span className="text-muted-foreground">{day.getDate()}</span>
            </span>
            {(grouped.get(key) ?? []).map((p) => (
              <Chip key={p.id} project={p} detailed />
            ))}
          </DayCell>
        );
      })}
    </div>
  );
}

function DayCell({
  date,
  muted,
  today,
  className,
  children,
}: {
  date: string;
  muted?: boolean;
  today?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date-${date}` });
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      className={cn(
        "flex flex-col gap-1 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
        muted && "bg-panel/40 opacity-60",
        today && "bg-active/40",
        isOver && "bg-brand/15",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Undated({ projects }: { projects: Project[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "undated" });
  return (
    <div ref={setNodeRef} className={cn("w-60 shrink-0 overflow-y-auto border-l p-3", isOver && "bg-brand/10")}>
      <div className="mb-2 text-[12px] font-medium text-muted-foreground">Sin fecha</div>
      <div className="grid gap-1.5">
        {projects.map((p) => (
          <Chip key={p.id} project={p} />
        ))}
        {projects.length === 0 && <p className="text-[12px] text-subtle">Arrastra aquí para quitar la fecha.</p>}
      </div>
    </div>
  );
}

function Board({ projects }: { projects: Project[] }) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" data-testid="board">
      {COLUMNS.map((c) => (
        <BoardColumn key={c.id} column={c} projects={projects.filter((p) => columnOf(p.status).id === c.id)} />
      ))}
    </div>
  );
}

function BoardColumn({ column, projects }: { column: (typeof COLUMNS)[number]; projects: Project[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });
  return (
    <div
      ref={setNodeRef}
      data-testid={`col-${column.id}`}
      className={cn(
        "flex w-56 shrink-0 flex-col rounded-md border bg-panel/50",
        column.manual && "border-dashed",
        isOver && (column.manual ? "bg-brand/15" : "bg-danger/10"),
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px] font-medium">
        {column.label}
        <span className="ml-auto text-subtle">{projects.length}</span>
      </div>
      <div className="grid content-start gap-1.5 overflow-y-auto p-2">
        {projects.map((p) => (
          <Chip key={p.id} project={p} detailed />
        ))}
      </div>
    </div>
  );
}

function Chip({ project, detailed }: { project: Project; detailed?: boolean }) {
  const navigate = useNavigate();
  const links = publishedLinks(project);
  const published = links.length > 0;
  // Lo publicado queda fijo en el día de su enlace: no se arrastra.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `project-${project.id}`,
    disabled: published,
  });
  const when = (iso: string) => new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
  const title = published
    ? [project.title, ...links.map((l) => `Publicado en ${PLATFORM_LABEL[l.platform] ?? l.platform} · ${when(l.published_at)}`)].join("\n")
    : `${project.title} · ${STATUS_LABEL[project.status]}`;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/proyectos/${project.id}`)}
      title={title}
      data-published={published || undefined}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        "relative z-0 w-full rounded border bg-background px-2 py-1 text-left text-[12px] hover:border-brand/60",
        published && "border-success-foreground/40 bg-success-foreground/10 hover:border-success-foreground/70",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <span className="flex items-center gap-1.5">
        {published && <CircleCheck className="size-3.5 shrink-0 text-success-foreground" aria-label="Publicado" />}
        <span className="block min-w-0 flex-1 truncate font-medium">{project.title}</span>
        {published && (
          <span className="flex shrink-0 gap-0.5">
            {links.map((l) => (
              <span key={l.platform} className={cn("size-1.5 rounded-full", PLATFORM_TONE[l.platform as PublishPlatform] ?? "bg-muted-foreground")} />
            ))}
          </span>
        )}
      </span>
      {detailed && (
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FormatBadge format={project.format} />
          <span className="truncate">
            {published
              ? `Publicado ${new Date(links[0].published_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} · ${links.map((l) => PLATFORM_LABEL[l.platform] ?? l.platform).join(", ")}`
              : STATUS_LABEL[project.status]}
          </span>
        </span>
      )}
    </button>
  );
}
