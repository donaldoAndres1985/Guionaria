import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOpenUrl, useRevealAsset } from "@/hooks/useManualMedia";
import { coreUrl, type Candidate } from "@/lib/api";
import { formatBytes, formatClip, formatResolution } from "./mediaMeta";
import { PROVIDER_LABEL, type MediaController } from "./useMediaController";

/** Vista grande (sección 5.6): el medio real y sus datos, con todas las acciones. */
export function MediaViewer({ ctl }: { ctl: MediaController }) {
  const c = ctl.viewer;
  const openUrl = useOpenUrl();
  const reveal = useRevealAsset();

  return (
    <Dialog open={!!c} onOpenChange={(open) => !open && ctl.closeViewer()}>
      <DialogContent
        className="flex h-[88vh] max-w-[min(1200px,94vw)] flex-col gap-0 overflow-hidden bg-panel p-0 sm:max-w-[min(1200px,94vw)]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") ctl.viewerNext();
          else if (e.key === "ArrowLeft") ctl.viewerPrev();
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {c && <ViewerBody c={c} ctl={ctl} openUrl={openUrl.mutate} reveal={reveal.mutate} />}
      </DialogContent>
    </Dialog>
  );
}

function ViewerBody({
  c,
  ctl,
  openUrl,
  reveal,
}: {
  c: Candidate;
  ctl: MediaController;
  openUrl: (url: string) => void;
  reveal: (assetId: number) => void;
}) {
  const asset = c.asset;
  const approvedRole = ctl.scene?.approved.find((a) => a.asset.id === asset?.id)?.role ?? null;
  const src = asset ? coreUrl(asset.file_url) : c.kind === "video" ? (c.full_url ?? c.video_preview_url) : c.full_url;
  const busy = c.download_status === "queued" || c.download_status === "downloading";
  const canDownload = ctl.editable && (c.download_status === "none" || c.download_status === "failed");
  const index = ctl.scene?.candidates.findIndex((x) => x.id === c.id) ?? 0;
  const total = ctl.scene?.candidates.length ?? 0;
  const shareUrl = c.page_url || c.full_url;

  const facts = [
    ["Proveedor", PROVIDER_LABEL[c.provider] ?? (c.provider === "manual" ? "Manual" : c.provider)],
    ["Resolución", formatResolution(asset?.width ?? c.width, asset?.height ?? c.height)],
    ["Duración", formatClip(asset?.duration_s ?? c.duration_s)],
    ["Orientación", asset?.orientation],
    ["Tamaño", asset ? formatBytes(asset.size_bytes) : null],
    ["Autor", asset?.author ?? c.author],
    ["Licencia", asset?.license ?? c.license],
    ["Archivo", asset?.file_name],
    ["Búsqueda", c.query],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-5 pr-12">
        <DialogTitle className="text-[14px]">
          Medio {index + 1} de {total}
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          Escena {ctl.scene?.position} · ← → para recorrer
        </DialogDescription>
        {approvedRole && (
          <span className="flex items-center gap-1 rounded bg-success px-1.5 py-0.5 text-[11px] text-success-foreground">
            <Star className="size-3" /> {approvedRole === "main" ? "Principal" : "Alterno"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 items-center justify-center bg-black">
          {c.kind === "video" && src ? (
            <video key={src} src={src} controls autoPlay className="max-h-full max-w-full" />
          ) : src ? (
            <img src={src} alt={c.query ?? ""} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[13px] text-white/60">Sin vista previa</span>
          )}
          {total > 1 && (
            <>
              <button type="button" aria-label="Anterior" onClick={ctl.viewerPrev}
                className="absolute left-3 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
                <ChevronLeft className="size-5" />
              </button>
              <button type="button" aria-label="Siguiente" onClick={ctl.viewerNext}
                className="absolute right-3 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>

        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="selectable min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {c.error && <p className="text-[12px] text-danger">{c.error}</p>}

          <div className="mt-auto grid gap-2">
            {asset && ctl.editable && approvedRole !== "main" && (
              <Button onClick={() => ctl.approve(asset.id, "main")}>Aprobar como principal</Button>
            )}
            {asset && ctl.editable && !approvedRole && (
              <Button variant="outline" onClick={() => ctl.approve(asset.id, "alt")}>
                Guardar como alterno
              </Button>
            )}
            {canDownload && (
              <>
                <Button onClick={() => ctl.downloadAndApprove(c.id)}>
                  <Download /> Descargar y aprobar
                </Button>
                <Button variant="outline" onClick={() => void ctl.download([c.id])}>
                  <Download /> Descargar
                </Button>
              </>
            )}
            {busy && <p className="text-center text-[12px] text-muted-foreground">Descargando…</p>}
            {shareUrl && (
              <Button variant="ghost" onClick={() => openUrl(shareUrl)}>
                <ExternalLink /> Abrir en navegador
              </Button>
            )}
            {shareUrl && (
              <Button
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard.writeText(shareUrl).then(() => toast.success("Dirección copiada"))
                }
              >
                <Copy /> Copiar URL
              </Button>
            )}
            {asset && (
              <Button variant="ghost" onClick={() => reveal(asset.id)}>
                <FolderOpen /> Mostrar en carpeta
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
