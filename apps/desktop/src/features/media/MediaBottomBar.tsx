import { Download, FolderOpen, LoaderCircle, Package, Unlock } from "lucide-react";
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
  const missing = overview.needing_media - overview.with_media;
  const pending = ctl.selectedPending;
  const progress = ctl.downloadAllJob?.progress ?? 0;
  const stats = [
    {
      label: "Escenas con medio",
      value: `${overview.with_media}/${overview.needing_media}`,
      highlight: true,
    },
    { label: "Elegidos", value: pending },
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
      {!complete && !ctl.downloadingAll && (
        <span className="hidden max-w-52 text-right text-[12px] leading-tight text-muted-foreground xl:block">
          {pending
            ? "Descarga lo elegido para dejar esas escenas con medio"
            : `Faltan ${missing} ${missing === 1 ? "escena" : "escenas"}: elige un medio en cada una`}
        </span>
      )}
      <Button
        variant={complete ? "outline" : "default"}
        size="lg"
        disabled={!ctl.editable || pending === 0 || ctl.downloadingAll}
        title="Descarga lo elegido en todas las escenas y deja el primero de cada una como principal"
        onClick={() => void ctl.downloadAll()}
      >
        {ctl.downloadingAll ? <LoaderCircle className="animate-spin" /> : <Download />}
        {ctl.downloadingAll
          ? `Descargando… ${Math.round(progress * 100)}%`
          : `Descargar y aprobar${pending ? ` (${pending})` : ""}`}
      </Button>
      <Button
        size="lg"
        className="min-w-40"
        disabled={!ctl.editable || !complete || approve.isPending}
        variant={complete ? "default" : "outline"}
        title={complete ? "Cerrar la etapa de medios y pasar a la voz" : `Faltan ${missing} escenas con medio principal`}
        onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success("Medios aprobados") })}
      >
        Aprobar medios
      </Button>
    </BottomBar>
  );
}
