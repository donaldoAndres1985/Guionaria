import { useState } from "react";
import { useNavigate } from "react-router";
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
import { useConvertIdea } from "@/hooks/useIdeas";
import type { Idea, ProjectFormat } from "@/lib/api";
import { cn } from "@/lib/utils";

const FORMATS: { id: ProjectFormat; title: string; hint: string; unit: string; def: number }[] = [
  { id: "video", title: "Video", hint: "16:9 · 8–20 min", unit: "minutos", def: 10 },
  { id: "reel", title: "Reel / Short", hint: "9:16 · 15–90 s", unit: "segundos", def: 60 },
];

/** Convierte la idea en proyecto: el título y las notas pasan al proyecto. */
export function ConvertIdeaDialog({ idea, onClose }: { idea: Idea | null; onClose: () => void }) {
  return (
    <Dialog open={idea !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-lg">{idea && <ConvertForm idea={idea} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ConvertForm({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const navigate = useNavigate();
  const convert = useConvertIdea();
  const [format, setFormat] = useState<ProjectFormat>("reel");
  const spec = FORMATS.find((f) => f.id === format)!;
  const [duration, setDuration] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const value = duration ?? spec.def;

  const submit = () =>
    convert.mutate(
      {
        id: idea.id,
        format,
        target_duration_s: Math.round(format === "video" ? value * 60 : value),
        target_publish_at: date || null,
      },
      {
        onSuccess: (project) => {
          toast.success("Proyecto creado desde la idea");
          onClose();
          navigate(`/proyectos/${project.id}`);
        },
      },
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Convertir en proyecto</DialogTitle>
        <DialogDescription>«{idea.title}» · {idea.channel_name}. Las notas pasan a las notas de investigación.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={format === f.id}
            onClick={() => {
              setFormat(f.id);
              setDuration(null);
            }}
            className={cn(
              "rounded-md border px-3 py-2 text-left",
              format === f.id ? "border-brand bg-active" : "hover:bg-panel-2",
            )}
          >
            <div className="text-[13px] font-medium">{f.title}</div>
            <div className="text-[11px] text-muted-foreground">{f.hint}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={`Duración (${spec.unit})`}>
          <Input type="number" min={1} value={value} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duración" />
        </FormField>
        <FormField label="Publicación objetivo">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Publicación objetivo" />
        </FormField>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={value <= 0 || convert.isPending} onClick={submit}>
          Crear proyecto
        </Button>
      </DialogFooter>
    </>
  );
}
