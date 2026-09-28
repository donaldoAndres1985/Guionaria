import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRestoreProject } from "@/hooks/useHistory";
import { useDeleteProject } from "@/hooks/useProjects";
import type { Project } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/project";

const WORD = "ELIMINAR";

/**
 * Eliminar un proyecto en cualquier etapa, con doble comprobación: el aviso de lo que se
 * pierde y escribir ELIMINAR. Va a la papelera (30 días) y se puede deshacer.
 */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: Pick<Project, "id" | "title" | "status" | "media_count" | "publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteProject();
  const restore = useRestoreProject();
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const ok = typed.trim().toUpperCase() === WORD;
  const published = (project.publications ?? []).filter((p) => p.status === "published").length;

  const confirm = () =>
    remove.mutate(project.id, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(`«${project.title}» enviado a la papelera`, {
          description: "Puedes restaurarlo durante 30 días desde Historial → Papelera.",
          action: { label: "Deshacer", onClick: () => restore.mutate(project.id) },
        });
        onDeleted?.();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4 text-danger" /> Eliminar proyecto
          </DialogTitle>
          <DialogDescription className="text-foreground">«{project.title}»</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          <ul className="grid gap-1 rounded-md border border-danger/30 bg-danger/5 p-3 text-[12px] text-muted-foreground">
            <li>
              Etapa actual: <span className="text-foreground">{STATUS_LABEL[project.status]}</span>
            </li>
            <li>Se mueve a la papelera con su guion, escenas, medios{project.media_count ? ` (${project.media_count})` : ""}, voz y render.</li>
            {published > 0 && (
              <li className="flex items-center gap-1.5 text-warning">
                <TriangleAlert className="size-3.5" /> Está publicado en {published} plataforma{published > 1 ? "s" : ""}: eso no se borra de ellas.
              </li>
            )}
            <li>Puedes restaurarlo durante 30 días (Historial → Papelera).</li>
          </ul>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Para confirmar, escribe <span className="font-mono font-medium text-foreground">{WORD}</span>
            <Input autoFocus aria-label="Escribe ELIMINAR para confirmar" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && confirm()} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={!ok || remove.isPending} onClick={confirm}>
            {remove.isPending ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Eliminar proyecto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
