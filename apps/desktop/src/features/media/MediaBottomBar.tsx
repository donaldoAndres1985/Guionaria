import { Download, FolderOpen, Package, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import { useApproveMedia, useUnlockMedia } from "@/hooks/useMedia";
import { useExportPackage, useRevealProject } from "@/hooks/useManualMedia";
import type { Project } from "@/lib/api";
import type { MediaController } from "./useMediaController";

export function MediaBottomBar({ project, ctl }: { project: Project; ctl: MediaController }) {
  const approve = useApproveMedia(project.id);
  const unlock = useUnlockMedia(project.id);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const overview = ctl.overview;
  const exportPackage = useExportPackage(project.id);
  const revealProject = useRevealProject();

  const packageButton = (
    <Button
      variant="ghost"
      disabled={exportPackage.isPending}
      title="Guion, escenas, créditos y LEEME en la carpeta del proyecto"
      onClick={() =>
        exportPackage.mutate(undefined, {
          onSuccess: (r) =>
            toast.success("Paquete exportado", {
              description: r.missing_media.length
                ? `Faltan medios en las escenas ${r.missing_media.join(", ")}`
                : r.files.join(" · "),
              action: { label: "Abrir carpeta", onClick: () => revealProject.mutate(project.id) },
            }),
        })
      }
    >
      <Package /> Exportar paquete
    </Button>
  );
  const folderButton = (
    <Button variant="ghost" size="icon" title="Abrir la carpeta del proyecto" onClick={() => revealProject.mutate(project.id)}>
      <FolderOpen />
    </Button>
  );

  if (!overview || overview.needing_media === 0) {
    return <BottomBar stats={[{ label: "Etapa", value: "Medios" }]} />;
  }

  const complete = overview.with_media >= overview.needing_media;
  const stats = [
    {
      label: "Escenas con medio",
      value: `${overview.with_media}/${overview.needing_media}`,
      highlight: true,
    },
    { label: "Seleccionados", value: ctl.selected.length },
  ];

  if (overview.approved) {
    return (
      <BottomBar stats={stats}>
        {folderButton}
        {packageButton}
        <Button variant="outline" onClick={() => setConfirmUnlock(true)}>
          <Unlock /> Desbloquear
        </Button>
        <Button size="lg" disabled>
          Medios aprobados
        </Button>
        <ConfirmDialog
          open={confirmUnlock}
          onOpenChange={setConfirmUnlock}
          title="¿Desbloquear los medios?"
          description="Podrás cambiar medios otra vez. Tendrás que aprobarlos de nuevo antes de la voz."
          confirmLabel="Desbloquear"
          onConfirm={() => {
            setConfirmUnlock(false);
            unlock.mutate();
          }}
        />
      </BottomBar>
    );
  }

  return (
    <BottomBar stats={stats}>
      {folderButton}
      {packageButton}
      <Button
        variant="outline"
        disabled={!ctl.editable || ctl.selected.length === 0 || ctl.downloading}
        onClick={() => void ctl.download()}
      >
        <Download /> Descargar seleccionados{ctl.selected.length ? ` (${ctl.selected.length})` : ""}
      </Button>
      <Button
        size="lg"
        className="min-w-40"
        disabled={!ctl.editable || !complete || approve.isPending}
        title={complete ? undefined : "Aprueba un medio principal en cada escena de video, imagen o material real"}
        onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success("Medios aprobados") })}
      >
        Aprobar medios
      </Button>
    </BottomBar>
  );
}
