import { ArrowRight, Lightbulb, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { FormField } from "@/components/FormField";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConvertIdeaDialog } from "@/features/planning/ConvertIdeaDialog";
import { useChannels } from "@/hooks/useChannels";
import { useCreateIdea, useDeleteIdea, useIdeas, useUpdateIdea } from "@/hooks/useIdeas";
import type { Idea, IdeaStatus } from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const TABS: { id: IdeaStatus; label: string }[] = [
  { id: "open", label: "Abiertas" },
  { id: "converted", label: "Convertidas" },
  { id: "discarded", label: "Descartadas" },
];

const PRIORITY_TONE: Record<number, string> = {
  1: "bg-active text-active-foreground",
  2: "bg-panel-2 text-muted-foreground",
  3: "bg-panel-2 text-subtle",
};

export function IdeasPage() {
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: ideas = [] } = useIdeas({ channel: channel?.id });
  const create = useCreateIdea();
  const [tab, setTab] = useState<IdeaStatus>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [converting, setConverting] = useState<Idea | null>(null);

  const visible = ideas.filter((i) => i.status === tab);
  const selected = ideas.find((i) => i.id === selectedId) ?? visible[0] ?? null;
  const targetChannel = channel ?? channels[0] ?? null;
  const open = ideas.filter((i) => i.status === "open");

  const add = () => {
    const title = draft.trim();
    if (!title || !targetChannel) return;
    create.mutate(
      { channel_id: targetChannel.id, title },
      {
        onSuccess: (idea) => {
          setDraft("");
          setTab("open");
          setSelectedId(idea.id);
        },
      },
    );
  };

  return (
    <PageLayout
      title="Ideas"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Abiertas", value: open.length, highlight: true },
            { label: "Prioridad alta", value: open.filter((i) => i.priority === 1).length },
            { label: "Convertidas", value: ideas.filter((i) => i.status === "converted").length },
          ]}
        >
          <Button size="lg" disabled={selected?.status !== "open"} onClick={() => selected && setConverting(selected)}>
            <ArrowRight /> Convertir en proyecto
          </Button>
        </BottomBar>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r">
          <div className="border-b p-3">
            <div className="flex gap-2">
              <Input
                aria-label="Nueva idea"
                placeholder={targetChannel ? `Nueva idea para ${targetChannel.name}…` : "Crea un canal primero"}
                value={draft}
                disabled={!targetChannel}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
              <Button size="icon" aria-label="Agregar idea" disabled={!draft.trim() || create.isPending} onClick={add}>
                <Plus />
              </Button>
            </div>
          </div>
          <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded px-2 py-1 text-[12px]",
                  tab === t.id ? "bg-panel-2 font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label} <span className="text-subtle">{ideas.filter((i) => i.status === t.id).length}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visible.length === 0 && (
              <p className="p-4 text-center text-[12px] text-muted-foreground">
                {tab === "open" ? "Escribe una idea arriba y pulsa Enter." : "No hay ideas aquí."}
              </p>
            )}
            {visible.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelectedId(i.id)}
                className={cn(
                  "relative flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left",
                  selected?.id === i.id
                    ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                    : "hover:bg-panel-2/60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{i.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {channel ? i.notes || "Sin notas" : i.channel_name}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-medium", PRIORITY_TONE[i.priority])}>
                  {PRIORITY_LABEL[i.priority]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <IdeaDetail key={selected.id} idea={selected} onConvert={() => setConverting(selected)} />
          ) : (
            <EmptyState
              icon={Lightbulb}
              title="El banco de ideas está vacío"
              description="Guarda ideas por canal con prioridad y notas, y conviértelas en proyecto con un clic. También puedes pedírselas a Claude por MCP."
            />
          )}
        </div>
      </div>
      <ConvertIdeaDialog idea={converting} onClose={() => setConverting(null)} />
    </PageLayout>
  );
}

function IdeaDetail({ idea, onConvert }: { idea: Idea; onConvert: () => void }) {
  const { data: channels = [] } = useChannels();
  const update = useUpdateIdea();
  const remove = useDeleteIdea();
  const [title, setTitle] = useState(idea.title);
  const [notes, setNotes] = useState(idea.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = idea.status !== "converted";

  const save = (patch: Partial<Idea>) => update.mutate({ id: idea.id, ...patch });

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
        <span className="text-[13px] font-medium">Idea</span>
        <span className="text-[12px] text-muted-foreground">{idea.channel_name}</span>
        <div className="ml-auto flex gap-1">
          {idea.status === "open" && (
            <Button size="sm" variant="ghost" onClick={() => save({ status: "discarded" })}>
              <X /> Descartar
            </Button>
          )}
          {idea.status === "discarded" && (
            <Button size="sm" variant="ghost" onClick={() => save({ status: "open" })}>
              <RotateCcw /> Reabrir
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Eliminar
          </Button>
        </div>
      </div>
      <div className="grid max-w-3xl gap-5 p-5">
        {idea.status === "converted" && idea.project_id && (
          <div className="flex items-center gap-3 rounded-md border bg-panel p-3 text-[13px]">
            {idea.project_in_trash ? "Su proyecto está en la papelera." : "Esta idea ya es un proyecto."}
            <Link
              to={idea.project_in_trash ? "/historial" : `/proyectos/${idea.project_id}`}
              className="ml-auto font-medium text-brand hover:underline"
            >
              {idea.project_in_trash ? "Ir a la papelera" : "Abrir proyecto"}
            </Link>
          </div>
        )}
        <FormField label="Título">
          <Input
            aria-label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== idea.title && save({ title: title.trim() })}
          />
        </FormField>
        <FormField label="Notas" hint="Fuentes, enfoque, datos confirmados. Pasan a las notas de investigación del proyecto.">
          <Textarea
            aria-label="Notas"
            rows={8}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (idea.notes ?? "") && save({ notes })}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Prioridad">
            <Select value={String(idea.priority)} onValueChange={(v) => save({ priority: Number(v) })}>
              <SelectTrigger className="w-full" aria-label="Prioridad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Canal">
            <Select value={String(idea.channel_id)} disabled={!editable} onValueChange={(v) => save({ channel_id: Number(v) })}>
              <SelectTrigger className="w-full" aria-label="Canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        {idea.status === "open" && (
          <div>
            <Button variant="outline" onClick={onConvert}>
              <ArrowRight /> Convertir en proyecto
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Eliminar «${idea.title}»?`}
        description={idea.project_id ? "El proyecto creado desde la idea no se borra." : "La idea se borra del banco."}
        confirmLabel="Eliminar idea"
        destructive
        onConfirm={() =>
          remove.mutate(idea.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.success("Idea eliminada");
            },
          })
        }
      />
    </>
  );
}
