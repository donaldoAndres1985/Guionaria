import { FileVideo, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useChannels } from "@/hooks/useChannels";
import { useImportVideo } from "@/hooks/useImported";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const ACCEPT = ".mp4,.mov,.m4v,.mkv,.webm,video/*";
const MB = 1024 * 1024;

/**
 * Importar un video ya terminado (CapCut, Premiere…) a un canal: queda como proyecto listo
 * para Publicación (textos con Claude, miniatura, subida o enlaces de cada plataforma).
 */
export function ImportVideoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const selected = useUiStore((s) => s.selectedChannelId);
  const importer = useImportVideo();
  const picker = useRef<HTMLInputElement>(null);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [transcribe, setTranscribe] = useState(true);
  const [over, setOver] = useState(false);

  // Al abrir se vacía el formulario (no cuando llegan los canales: se perdería el archivo).
  useEffect(() => {
    if (!open) return;
    setChannelId(null);
    setFile(null);
    setTitle("");
    setNotes("");
    setDate("");
    setTranscribe(true);
  }, [open]);
  // Canal por defecto: el del selector del encabezado o el primero.
  useEffect(() => {
    if (open && channelId === null && channels.length) setChannelId(selected ?? channels[0].id);
  }, [open, channelId, channels, selected]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|m4v|mkv|webm)$/i.test(f.name)) {
      toast.error("Eso no es un video: usa MP4, MOV, M4V, MKV o WebM");
      return;
    }
    setFile(f);
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = () => {
    if (!file || !channelId) return;
    importer.mutate(
      { channelId, file, title: title.trim(), notes, targetPublishAt: date, transcribe },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          toast.success("Video importado", {
            description: r.job ? "Whisper está transcribiendo el audio para los textos de Claude." : undefined,
          });
          navigate(`/proyectos/${r.project.id}?etapa=publicacion`);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo importar el video"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !importer.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Importar video terminado</DialogTitle>
          <DialogDescription>
            Un video que ya editaste (CapCut, Premiere…). Se salta la producción y queda listo para publicar: textos con Claude,
            miniatura y enlaces de cada plataforma.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div
            data-testid="import-drop"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              "grid place-items-center gap-2 rounded-md border border-dashed p-5 text-center text-[12px] text-muted-foreground",
              over && "border-brand bg-active",
            )}
          >
            <FileVideo className="size-7 text-brand" />
            {file ? (
              <span className="text-foreground">
                {file.name} · {(file.size / MB).toFixed(0)} MB
              </span>
            ) : (
              <span>Arrastra aquí el video o</span>
            )}
            <Button size="sm" variant="outline" onClick={() => picker.current?.click()}>
              {file ? "Elegir otro" : "Elegir archivo"}
            </Button>
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              hidden
              aria-label="Archivo de video"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <FormField label="Canal">
            <Select value={channelId ? String(channelId) : undefined} onValueChange={(v) => setChannelId(Number(v))}>
              <SelectTrigger className="w-full" aria-label="Canal">
                <SelectValue placeholder="Elige el canal" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Título del proyecto">
            <Input aria-label="Título del proyecto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Por defecto, el nombre del archivo" />
          </FormField>
          <FormField label="¿De qué trata?" hint="Datos, nombres y fuentes: Claude los usa para la descripción (junto con lo que se dice en el video).">
            <Textarea aria-label="De qué trata" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Publicación objetivo">
              <Input type="date" aria-label="Publicación objetivo" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <label className="flex items-end justify-between gap-2 pb-2 text-[12px]" title="Local y gratis: sirve para que Claude sepa qué se dice en el video">
              <span>Transcribir el audio (Whisper)</span>
              <Switch aria-label="Transcribir el audio" checked={transcribe} onCheckedChange={setTranscribe} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={importer.isPending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!file || !channelId || importer.isPending} onClick={submit}>
            {importer.isPending ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {importer.isPending ? "Importando…" : "Importar y preparar publicación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
