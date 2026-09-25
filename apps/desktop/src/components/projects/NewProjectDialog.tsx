import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useChannels } from "@/hooks/useChannels";
import { useCreateProject } from "@/hooks/useProjects";
import type { ProjectFormat } from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const FORMATS: { id: ProjectFormat; title: string; hint: string; unit: string; def: number }[] = [
  { id: "video", title: "Video", hint: "16:9 · 1920×1080 · 8–20 min", unit: "minutos", def: 10 },
  { id: "reel", title: "Reel / Short", hint: "9:16 · 1080×1920 · 15–90 s", unit: "segundos", def: 60 },
];

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel sm:max-w-2xl">
        {/* Se monta solo abierto: cada apertura empieza con el formulario limpio. */}
        {open && <NewProjectForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const create = useCreateProject();

  const [format, setFormat] = useState<ProjectFormat>("video");
  // Sin elección explícita se usa el canal del encabezado; se calcula en cada render porque
  // los canales pueden terminar de cargar después de abrir el diálogo.
  const [chosenChannelId, setChannelId] = useState<number | null>(null);
  const channelId =
    chosenChannelId ??
    channels.find((c) => c.id === selectedChannelId)?.id ??
    channels[0]?.id ??
    null;
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState<number>(FORMATS[0].def);
  const [publishAt, setPublishAt] = useState("");
  const [priority, setPriority] = useState(2);

  const fmt = FORMATS.find((f) => f.id === format)!;
  const valid = channelId !== null && title.trim().length > 0 && duration > 0;

  const chooseFormat = (id: ProjectFormat) => {
    setFormat(id);
    setDuration(FORMATS.find((f) => f.id === id)!.def);
  };

  const submit = () => {
    if (!valid) return;
    create.mutate(
      {
        channel_id: channelId,
        title: title.trim(),
        format,
        topic: topic.trim() || null,
        research_notes: notes.trim() || null,
        target_duration_s: format === "video" ? Math.round(duration * 60) : Math.round(duration),
        target_publish_at: publishAt || null,
        priority,
        tags: [],
      },
      {
        onSuccess: (project) => {
          toast.success(`Proyecto "${project.title}" creado`);
          onDone();
          navigate(`/proyectos/${project.id}`);
        },
      },
    );
  };

  if (channels.length === 0) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
          <DialogDescription>
            Cada proyecto pertenece a un canal. Crea tu primer canal para empezar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild onClick={onDone}>
            <Link to="/canales?nuevo=1">Crear canal</Link>
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Nuevo proyecto</DialogTitle>
        <DialogDescription>
          El formato no se puede cambiar después: define la orientación de todos los medios.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => chooseFormat(f.id)}
              className={cn(
                "flex items-center gap-4 rounded-md border p-4 text-left transition-colors",
                format === f.id ? "border-brand bg-active" : "hover:bg-panel-2",
              )}
            >
              <span className="flex size-12 shrink-0 items-center justify-center">
                <span
                  className={cn(
                    "block rounded-[3px] border-2",
                    format === f.id ? "border-brand" : "border-muted-foreground",
                    f.id === "video" ? "h-[27px] w-12" : "h-12 w-[27px]",
                  )}
                />
              </span>
              <span>
                <span className="block text-[14px] font-medium">{f.title}</span>
                <span className="block text-[12px] text-muted-foreground">{f.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <FormField label="Canal">
            <Select value={channelId?.toString()} onValueChange={(v) => setChannelId(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige un canal" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Título tentativo">
            <Input
              autoFocus
              value={title}
              placeholder="El secuestro más largo de Ciudad de México"
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Tema o caso">
          <Textarea
            rows={2}
            value={topic}
            placeholder="De qué trata el video, en una o dos frases."
            onChange={(e) => setTopic(e.target.value)}
          />
        </FormField>

        <FormField label="Notas de investigación" hint="Claude se basa en ellas y marca los datos que no estén aquí.">
          <Textarea
            rows={4}
            value={notes}
            placeholder="Fechas, nombres, fuentes, enlaces…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        <div className="grid grid-cols-3 gap-4">
          <FormField label={`Duración (${fmt.unit})`}>
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Publicación objetivo">
            <Input type="date" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </FormField>
          <FormField label="Prioridad">
            <Select value={priority.toString()} onValueChange={(v) => setPriority(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((p) => (
                  <SelectItem key={p} value={p.toString()}>
                    {PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          Crear proyecto
        </Button>
      </DialogFooter>
    </form>
  );
}
