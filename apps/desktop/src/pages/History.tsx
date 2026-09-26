import { Bot, Cog, History, RotateCcw, Trash2, User } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge } from "@/components/projects/badges";
import { Button } from "@/components/ui/button";
import { ACTOR_LABEL, GROUPS, groupByDay, timeLabel } from "@/features/history/historyMeta";
import { formatSize } from "@/features/storage/treemap";
import { useEmptyTrash, useHistory, usePurgeProject, useRestoreProject, useTrash } from "@/hooks/useHistory";
import type { HistoryActor, TrashItem } from "@/lib/api";
import { formatDate } from "@/lib/project";
import { cn } from "@/lib/utils";

const ACTOR_ICON = { ui: User, mcp: Bot, system: Cog } as const;

export function HistoryPage() {
  const [tab, setTab] = useState<"history" | "trash">("history");
  const { data: trash = [] } = useTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const empty = useEmptyTrash();

  return (
    <PageLayout
      title="Historial de operaciones"
      bottomBar={
        <BottomBar
          stats={[
            { label: "En la papelera", value: trash.length, highlight: true },
            { label: "Espacio en la papelera", value: formatSize(trash.reduce((n, t) => n + t.bytes, 0)) },
          ]}
        >
          <Button variant="outline" size="lg" disabled={!trash.length} onClick={() => setConfirmEmpty(true)}>
            <Trash2 /> Vaciar papelera
          </Button>
        </BottomBar>
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {(
          [
            ["history", "Historial"],
            ["trash", `Papelera (${trash.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded px-3 py-1.5 text-[13px]",
              tab === id ? "bg-panel-2 font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "history" ? <HistoryList /> : <TrashList items={trash} />}
      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="¿Vaciar la papelera?"
        description={`Se borran definitivamente ${trash.length} proyectos con sus archivos. No se puede deshacer.`}
        confirmLabel="Vaciar papelera"
        destructive
        pending={empty.isPending}
        onConfirm={() =>
          empty.mutate(undefined, {
            onSuccess: (r) => {
              setConfirmEmpty(false);
              toast.success(`${r.purged} proyectos borrados definitivamente`);
            },
          })
        }
      />
    </PageLayout>
  );
}

function HistoryList() {
  const [actor, setActor] = useState<HistoryActor | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const history = useHistory({ actor, group });
  const restore = useRestoreProject();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px]",
        active ? "border-brand bg-active text-active-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        {chip(actor === null, "Todos", () => setActor(null))}
        {(Object.keys(ACTOR_LABEL) as HistoryActor[]).map((a) => chip(actor === a, ACTOR_LABEL[a], () => setActor(a)))}
        <span className="mx-2 h-4 w-px bg-border" />
        {chip(group === null, "Todo", () => setGroup(null))}
        {GROUPS.map((g) => chip(group === g.id, g.label, () => setGroup(g.id)))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!history.isPending && items.length === 0 && (
          <EmptyState icon={History} title="Sin operaciones" description="Aquí aparece lo que se genera, aprueba, descarga o borra." />
        )}
        {groupByDay(items).map((g) => (
          <section key={g.day}>
            <h3 className="sticky top-0 bg-background pt-4 pb-2 text-[12px] font-medium text-muted-foreground capitalize">{g.day}</h3>
            <div className="divide-y rounded-md border">
              {g.items.map((i) => {
                const Icon = ACTOR_ICON[i.actor];
                return (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="w-11 shrink-0 font-mono text-[11px] text-subtle">{timeLabel(i.at)}</span>
                    <span
                      className={cn(
                        "flex w-28 shrink-0 items-center gap-1.5 text-[12px]",
                        i.actor === "mcp" ? "text-brand" : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" /> {ACTOR_LABEL[i.actor]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{i.text}</span>
                    {i.project_title &&
                      (i.project_id && !i.can_restore && i.action !== "purge" ? (
                        <Link to={`/proyectos/${i.project_id}`} className="max-w-56 shrink-0 truncate text-[12px] text-brand hover:underline">
                          {i.project_title}
                        </Link>
                      ) : (
                        <span className="max-w-56 shrink-0 truncate text-[12px] text-muted-foreground">{i.project_title}</span>
                      ))}
                    {i.can_restore && i.project_id && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={restore.isPending}
                        onClick={() =>
                          restore.mutate(i.project_id!, { onSuccess: () => toast.success(`«${i.project_title}» restaurado`) })
                        }
                      >
                        <RotateCcw /> Restaurar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {history.hasNextPage && (
          <div className="flex justify-center pt-4">
            <Button size="sm" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
              Cargar anteriores
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function TrashList({ items }: { items: TrashItem[] }) {
  const restore = useRestoreProject();
  const purge = usePurgeProject();
  const [purging, setPurging] = useState<TrashItem | null>(null);

  if (!items.length) {
    return (
      <EmptyState
        icon={Trash2}
        title="La papelera está vacía"
        description="Los proyectos eliminados quedan aquí 30 días con todos sus archivos, por si quieres restaurarlos."
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="divide-y rounded-md border">
        {items.map((t) => (
          <div key={t.project_id} className="flex items-center gap-4 px-4 py-3 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium">
                {t.title} <FormatBadge format={t.format} />
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {t.channel_name} · eliminado el {formatDate(t.deleted_at)} · {formatSize(t.bytes)}
              </span>
            </span>
            <span className={cn("text-[12px]", t.days_left <= 3 ? "text-danger" : "text-muted-foreground")}>
              {t.days_left === 0 ? "Se borra hoy" : `Se borra en ${t.days_left} días`}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate(t.project_id, { onSuccess: () => toast.success(`«${t.title}» restaurado`) })}
            >
              <RotateCcw /> Restaurar
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-danger" onClick={() => setPurging(t)}>
              <Trash2 /> Borrar
            </Button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(o) => !o && setPurging(null)}
        title={`¿Borrar «${purging?.title}» definitivamente?`}
        description="Se borran el proyecto y todos sus archivos. No se puede deshacer."
        confirmLabel="Borrar definitivamente"
        destructive
        pending={purge.isPending}
        onConfirm={() =>
          purging &&
          purge.mutate(purging.project_id, {
            onSuccess: () => {
              setPurging(null);
              toast.success("Proyecto borrado definitivamente");
            },
          })
        }
      />
    </div>
  );
}
