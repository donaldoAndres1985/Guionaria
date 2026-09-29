import { CalendarClock, ExternalLink, FileVideo, Send } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { ImportVideoDialog } from "@/components/projects/ImportVideoDialog";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { PLATFORM_TONE, STATUS_LABEL } from "@/features/publishing/publishingMeta";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { usePublishingQueue } from "@/hooks/usePublishing";
import type { QueueItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const STATUS_TONE: Record<QueueItem["status"], string> = {
  draft: "text-muted-foreground",
  scheduled: "text-brand",
  uploading: "text-brand",
  published: "text-success-foreground",
  failed: "text-danger",
};

function when(item: QueueItem): string {
  const iso = item.status === "published" ? item.published_at : (item.scheduled_at ?? item.target_publish_at);
  if (!iso) return "Sin fecha";
  const d = new Date(iso.length === 10 ? `${iso}T00:00` : iso);
  return item.scheduled_at || item.published_at
    ? d.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })
    : `Objetivo: ${d.toLocaleDateString("es", { dateStyle: "medium" })}`;
}

/** Cola de publicación de todos los canales (o del canal elegido): pendientes por fecha y lo publicado. */
export function PublishingPage() {
  const channelId = useUiStore((s) => s.selectedChannelId);
  const { data: items = [], isLoading } = usePublishingQueue(channelId);
  const navigate = useNavigate();
  const openUrl = useOpenUrl();
  const pending = items.filter((i) => i.status !== "published");
  const done = items.filter((i) => i.status === "published");
  const [importing, setImporting] = useState(false);
  const importButton = (
    <Button size="sm" variant="outline" onClick={() => setImporting(true)} title="Un video ya editado en CapCut u otro editor">
      <FileVideo /> Importar video terminado
    </Button>
  );

  return (
    <PageLayout
      title="Publicación"
      actions={
        <div className="flex items-center gap-2">
          {importButton}
          <ChannelSelector />
        </div>
      }
    >
      <ImportVideoDialog open={importing} onOpenChange={setImporting} />
      {!isLoading && !items.length ? (
        <EmptyState
          icon={Send}
          title="La cola de publicación está vacía"
          description="Cuando renderices un proyecto, abre su etapa «Publicación» para preparar los textos y programarlo en cada plataforma. ¿Ya tienes el video editado en CapCut? Impórtalo."
          action={importButton}
        />
      ) : (
        <div className="grid gap-6 overflow-y-auto p-5">
          {[
            ["Pendiente", pending],
            ["Publicado", done],
          ].map(([title, list]) =>
            (list as QueueItem[]).length ? (
              <section key={title as string} aria-label={title as string}>
                <h2 className="mb-2 text-[13px] font-medium">
                  {title as string} <span className="text-muted-foreground">· {(list as QueueItem[]).length}</span>
                </h2>
                <div className="overflow-hidden rounded-md border">
                  {(list as QueueItem[]).map((item) => (
                    <div key={item.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-panel-2" data-testid="queue-row">
                      <span className={cn("size-2.5 shrink-0 rounded-full", PLATFORM_TONE[item.platform])} title={item.label} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => navigate(`/proyectos/${item.project_id}?etapa=publicacion`)}
                      >
                        <span className="block truncate text-[13px] font-medium">{item.title}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {item.label} · {item.channel_name} · {item.project_title}
                        </span>
                      </button>
                      <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-muted-foreground">
                        <CalendarClock className="size-3.5" /> {when(item)}
                      </span>
                      <span className={cn("w-24 text-right text-[12px]", STATUS_TONE[item.status])}>{STATUS_LABEL[item.status]}</span>
                      {item.external_url ? (
                        <button type="button" aria-label={`Abrir ${item.label}`} className="text-muted-foreground hover:text-foreground" onClick={() => openUrl.mutate(item.external_url!)}>
                          <ExternalLink className="size-4" />
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </PageLayout>
  );
}
