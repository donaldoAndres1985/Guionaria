import { FileAudio, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useChannels } from "@/hooks/useChannels";
import { useUploadSounds } from "@/hooks/useSounds";
import type { Sound, SoundKind } from "@/lib/api";
import { ATTRIBUTION_EXAMPLE, parseAttribution } from "./attribution";

const AUDIO_ACCEPT = ".mp3,.wav,.ogg,.flac,.m4a,.aac,audio/*";
const NO_CHANNEL = "__none__";

/**
 * Sube un audio a la biblioteca (común a todos los canales) con su atribución. De la
 * atribución salen solos el título, el autor, la licencia y el enlace; y puede quedar
 * como favorito de un canal para que salga primero al elegirlo.
 */
export function UploadSoundDialog({
  open,
  onClose,
  kind,
  channelId,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  kind: SoundKind;
  /** Canal propuesto como favorito (el del proyecto abierto). */
  channelId?: number | null;
  onAdded?: (sounds: Sound[]) => void;
}) {
  const { data: channels = [] } = useChannels();
  const upload = useUploadSounds();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [attribution, setAttribution] = useState("");
  const [favorite, setFavorite] = useState<string>(NO_CHANNEL);
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setAttribution("");
    setFavorite(channelId ? String(channelId) : NO_CHANNEL);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseAttribution(attribution);
  const facts = [
    ["Título", parsed.title],
    ["Autor", parsed.author],
    ["Licencia", parsed.license],
    ["Enlace", parsed.license_url],
  ].filter(([, v]) => v) as [string, string][];

  const submit = () =>
    upload.mutate(
      { files, kind, attribution, favoriteChannel: favorite === NO_CHANNEL ? null : Number(favorite) },
      {
        onSuccess: (added) => {
          toast.success(added.length === 1 ? `«${added[0].title}» guardado en la biblioteca` : `${added.length} audios guardados en la biblioteca`);
          onAdded?.(added);
          onClose();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo subir el audio"),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dismissOnOutsideClick={false} className="bg-panel sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === "music" ? "Agregar música" : "Agregar efecto"}</DialogTitle>
          <DialogDescription>Queda en la biblioteca y lo puedes usar en cualquier canal. La atribución va a los créditos de la descripción.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-[13px]">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
              <FileAudio /> Elegir archivo
            </Button>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {files.length === 0 ? "MP3, WAV, OGG, FLAC…" : files.map((f) => f.name).join(", ")}
            </span>
            <input
              ref={picker}
              type="file"
              multiple
              accept={AUDIO_ACCEPT}
              hidden
              aria-label="Archivo de audio"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
          <FormField label="Atribución" hint="Pega el texto que pide la licencia, tal cual.">
            <Textarea aria-label="Atribución del nuevo audio" rows={4} placeholder={ATTRIBUTION_EXAMPLE} value={attribution} onChange={(e) => setAttribution(e.target.value)} />
          </FormField>
          {facts.length > 0 && (
            <dl className="grid grid-cols-[72px_1fr] gap-y-1 rounded-md border bg-panel-2/50 px-3 py-2 text-[12px]" aria-label="Datos de la atribución">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <FormField label="Favorito del canal" hint="Sale primero al elegir audio en ese canal. Los demás canales también pueden usarlo.">
            <Select value={favorite} onValueChange={setFavorite}>
              <SelectTrigger className="w-full" aria-label="Favorito del canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANNEL}>Ninguno</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={files.length === 0 || upload.isPending} onClick={submit}>
            {upload.isPending ? <LoaderCircle className="animate-spin" /> : <Upload />} Guardar en la biblioteca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
