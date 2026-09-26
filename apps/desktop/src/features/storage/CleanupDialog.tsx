import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCleanup } from "@/hooks/useStorage";
import type { CleanupPreview } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/project";
import { formatSize } from "./treemap";

/** Limpieza de candidatos descargados que no se aprobaron (sección 5.11). */
export function CleanupDialog({
  open,
  preview,
  onClose,
}: {
  open: boolean;
  preview: CleanupPreview | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-xl">
        {open && preview && <CleanupForm preview={preview} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CleanupForm({ preview, onClose }: { preview: CleanupPreview; onClose: () => void }) {
  const cleanup = useCleanup();
  // Por defecto, solo los proyectos con los medios ya aprobados.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preview.projects.filter((p) => p.media_approved).map((p) => p.project_id)),
  );
  const chosen = preview.projects.filter((p) => selected.has(p.project_id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Liberar espacio</DialogTitle>
        <DialogDescription>
          Se borran los archivos de los candidatos descargados que no se aprobaron. Siguen en la lista de cada escena
          para volver a descargarlos si hace falta. Los aprobados no se tocan.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
        {preview.projects.map((p) => (
          <label key={p.project_id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-panel-2/60">
            <input type="checkbox" checked={selected.has(p.project_id)} onChange={() => toggle(p.project_id)} aria-label={p.title} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.title}</span>
              <span className="block text-[12px] text-muted-foreground">
                {p.channel_name} · {STATUS_LABEL[p.status]}
                {!p.media_approved && " · medios todavía en revisión"}
              </span>
            </span>
            <span className="text-right text-[12px]">
              <span className="block font-medium">{formatSize(p.bytes)}</span>
              <span className="block text-muted-foreground">{p.count} archivos</span>
            </span>
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="destructive"
          disabled={!chosen.length || cleanup.isPending}
          onClick={() =>
            cleanup.mutate(
              chosen.map((p) => p.project_id),
              {
                onSuccess: (r) => {
                  toast.success(`Se liberaron ${formatSize(r.freed_bytes)} (${r.deleted} archivos)`);
                  onClose();
                },
              },
            )
          }
        >
          Borrar {chosen.reduce((n, p) => n + p.count, 0)} archivos · {formatSize(chosen.reduce((n, p) => n + p.bytes, 0))}
        </Button>
      </DialogFooter>
    </>
  );
}
