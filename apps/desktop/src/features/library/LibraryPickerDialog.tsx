import { Recycle, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatClip } from "@/features/media/mediaMeta";
import { useLibrary, useReuseAsset } from "@/hooks/useLibrary";
import { coreUrl, type SceneMedia } from "@/lib/api";
import { providerLabel, usageLabel } from "./libraryMeta";

/** Elegir un medio ya descargado (de cualquier proyecto) para la escena actual. */
export function LibraryPickerDialog({
  scene,
  orientation,
  open,
  onClose,
}: {
  scene: SceneMedia;
  orientation: "landscape" | "portrait";
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [anyOrientation, setAnyOrientation] = useState(false);
  const kind = scene.media_kind === "video" ? "video" : scene.media_kind === "image" ? "image" : null;
  const { data } = useLibrary(
    { kind, q, orientation: anyOrientation ? null : orientation, page_size: 48 },
    open,
  );
  const reuse = useReuseAsset();
  const inScene = new Set(scene.candidates.map((c) => c.asset?.file_name));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Biblioteca</DialogTitle>
          <DialogDescription>
            Medios ya descargados en tus proyectos. Usarlos no los vuelve a descargar ni ocupa espacio extra.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Buscar en la biblioteca" placeholder="Nombre, autor u origen" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={anyOrientation} onChange={(e) => setAnyOrientation(e.target.checked)} />
            Otras orientaciones
          </label>
        </div>
        <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto" data-testid="picker-grid">
          {(data?.items ?? []).map((i) => (
            <div key={i.asset.id} className="overflow-hidden rounded-md border bg-background">
              {i.asset.thumb_url || i.asset.kind === "image" ? (
                <img src={coreUrl(i.asset.thumb_url ?? i.asset.file_url)} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video w-full bg-panel-2" />
              )}
              <div className="grid gap-1 p-2">
                <div className="truncate text-[12px] font-medium">{i.project_title ?? i.asset.file_name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {providerLabel(i.asset.provider)}
                  {i.asset.duration_s ? ` · ${formatClip(i.asset.duration_s)}` : ""} · {usageLabel(i)}
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={reuse.isPending || inScene.has(i.asset.file_name)}
                  onClick={() =>
                    reuse.mutate(
                      { assetId: i.asset.id, sceneId: scene.scene_id },
                      { onSuccess: () => toast.success("Agregado a la escena: apruébalo para usarlo") },
                    )
                  }
                >
                  <Recycle /> Usar en esta escena
                </Button>
              </div>
            </div>
          ))}
          {data && data.items.length === 0 && (
            <p className="col-span-4 py-10 text-center text-[13px] text-muted-foreground">No hay medios que coincidan.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
