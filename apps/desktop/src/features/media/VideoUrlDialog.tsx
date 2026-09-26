import { LoaderCircle, Scissors } from "lucide-react";
import { useState } from "react";
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
import { parseClock, urlFromText } from "./dropUtils";
import type { MediaController } from "./useMediaController";

/** Video desde URL con yt-dlp; el fragmento es opcional (sección 19: tramos cortos). */
export function VideoUrlDialog({ ctl }: { ctl: MediaController }) {
  const open = ctl.videoDialogUrl !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ctl.closeVideoDialog()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-lg">
        {open && <VideoUrlForm ctl={ctl} initialUrl={ctl.videoDialogUrl ?? ""} />}
      </DialogContent>
    </Dialog>
  );
}

function VideoUrlForm({ ctl, initialUrl }: { ctl: MediaController; initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const start = parseClock(from);
  const end = parseClock(to);
  const validUrl = urlFromText(url) !== null;
  const fragmentError =
    Number.isNaN(start) || Number.isNaN(end)
      ? "Usa minutos:segundos, por ejemplo 1:25"
      : (start === null) !== (end === null)
        ? "Indica inicio y fin, o deja ambos vacíos para el video completo"
        : start !== null && end !== null && end <= start
          ? "El fin debe ser mayor que el inicio"
          : null;

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (validUrl && !fragmentError) void ctl.downloadVideo(url.trim(), start, end).catch(() => {});
      }}
    >
      <DialogHeader>
        <DialogTitle>Video desde URL</DialogTitle>
        <DialogDescription>
          YouTube, noticias o redes. Se baja con yt-dlp hasta 1080p y se agrega a la escena{" "}
          {ctl.scene?.position}. Usa tramos cortos, con comentario y crédito.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <FormField label="Dirección del video">
          <Input
            autoFocus={!initialUrl}
            value={url}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={<span className="flex items-center gap-1.5"><Scissors className="size-3.5" /> Desde (opcional)</span>}>
            <Input autoFocus={!!initialUrl} value={from} placeholder="1:25" onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="Hasta (opcional)">
            <Input value={to} placeholder="1:32" onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
        {fragmentError && (from || to) && <p className="text-[12px] text-danger">{fragmentError}</p>}
        {!fragmentError && start !== null && end !== null && (
          <p className="text-[12px] text-muted-foreground">Se bajará un fragmento de {Math.round((end - start) * 10) / 10} s.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={ctl.closeVideoDialog}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!validUrl || !!fragmentError || ctl.downloadingVideo}>
          {ctl.downloadingVideo && <LoaderCircle className="animate-spin" />}
          Descargar video
        </Button>
      </DialogFooter>
    </form>
  );
}
