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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KIND_LABEL } from "@/features/scenes/sceneMeta";
import { useReuseAsset } from "@/hooks/useLibrary";
import { useProjects } from "@/hooks/useProjects";
import { useScenes } from "@/hooks/useScenes";
import type { LibraryItem } from "@/lib/api";
import { REUSE_STATUSES } from "./libraryMeta";

/** Reutiliza un medio de la biblioteca en una escena de otro proyecto. */
export function ReuseDialog({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-lg">{item && <ReuseForm item={item} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ReuseForm({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { data: projects = [] } = useProjects();
  const open = projects.filter((p) => (REUSE_STATUSES as readonly string[]).includes(p.status));
  const [projectId, setProjectId] = useState<number | null>(null);
  const [sceneId, setSceneId] = useState<number | null>(null);
  const { data: scenes } = useScenes(projectId ?? 0);
  const reuse = useReuseAsset();
  const navigate = useNavigate();
  const targets = (projectId ? (scenes?.scenes ?? []) : []).filter((s) =>
    ["video", "image", "real"].includes(s.media_kind),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reutilizar en otro proyecto</DialogTitle>
        <DialogDescription>
          «{item.asset.file_name}» queda como candidato de la escena elegida. Es un enlace al mismo archivo: no ocupa
          espacio de nuevo.
        </DialogDescription>
      </DialogHeader>
      {open.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No hay proyectos en la etapa de medios. Aprueba las escenas de un proyecto para poder reutilizar medios.
        </p>
      ) : (
        <div className="grid gap-4">
          <FormField label="Proyecto">
            <Select
              value={projectId ? String(projectId) : undefined}
              onValueChange={(v) => {
                setProjectId(Number(v));
                setSceneId(null);
              }}
            >
              <SelectTrigger className="w-full" aria-label="Proyecto">
                <SelectValue placeholder="Elige el proyecto" />
              </SelectTrigger>
              <SelectContent>
                {open.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.title} · {p.channel_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Escena">
            <Select value={sceneId ? String(sceneId) : undefined} onValueChange={(v) => setSceneId(Number(v))} disabled={!projectId}>
              <SelectTrigger className="w-full" aria-label="Escena">
                <SelectValue placeholder="Elige la escena" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.position} · {KIND_LABEL[s.media_kind]} · {s.visual_description ?? s.narration ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={!sceneId || reuse.isPending}
          onClick={() =>
            sceneId &&
            reuse.mutate(
              { assetId: item.asset.id, sceneId },
              {
                onSuccess: () => {
                  toast.success("Medio agregado a la escena", {
                    action: { label: "Abrir proyecto", onClick: () => navigate(`/proyectos/${projectId}`) },
                  });
                  onClose();
                },
              },
            )
          }
        >
          Reutilizar
        </Button>
      </DialogFooter>
    </>
  );
}
