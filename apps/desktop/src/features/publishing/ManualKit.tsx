import { Check, ClipboardCopy, Copy, ExternalLink, FolderOpen, ImageIcon, ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { coreUrl, type Publication, type PublishingState } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PublishController } from "./PublishStage";

type RevealFile = "video" | "thumbnail" | "subtitles";

export type KitAction =
  | { kind: "open" }
  | { kind: "copy"; text: string; what: string }
  | { kind: "reveal"; file: RevealFile; available: boolean }
  | { kind: "image"; available: boolean }
  | { kind: "info" };

export interface KitStep {
  id: string;
  label: string;
  hint?: string;
  action: KitAction;
}

const when = (iso: string) => new Date(iso).toLocaleString("es", { dateStyle: "full", timeStyle: "short" });
const VISIBILITY = { public: "Pública", unlisted: "No listada", private: "Privada" } as const;

function scheduleStep(pub: Publication): KitStep {
  return pub.scheduled_at
    ? { id: "schedule", label: `Programar para el ${when(pub.scheduled_at)}`, hint: "Elige «Programar» con esa fecha y hora", action: { kind: "info" } }
    : { id: "schedule", label: "Publicar ahora", hint: "O programa una fecha arriba para que quede anotada", action: { kind: "info" } };
}

/** Pasos para publicar a mano, en el orden en que los pide cada plataforma. */
export function kitSteps(pub: Publication, state: PublishingState): KitStep[] {
  const has = { video: !!state.video_file, thumb: !!pub.thumbnail_url, srt: state.subtitles };
  const tags = pub.tags.join(", ");
  const pinned = pub.meta.pinned_comment?.trim();
  const reel = state.format === "reel";
  const common = {
    open: { id: "open", label: `Abre ${pub.label}`, action: { kind: "open" } } as KitStep,
    video: { id: "video", label: "Sube el video: arrástralo desde la carpeta", action: { kind: "reveal", file: "video", available: has.video } } as KitStep,
    pinned: pinned
      ? ({ id: "pinned", label: "Después de publicar: comenta y fija", hint: pinned, action: { kind: "copy", text: pinned, what: "Comentario" } } as KitStep)
      : null,
    credits: state.credits
      ? ({ id: "credits", label: "Créditos de los medios en el primer comentario", hint: "Esta plataforma no tiene espacio para la descripción larga", action: { kind: "copy", text: state.credits, what: "Créditos" } } as KitStep)
      : null,
  };
  let steps: (KitStep | null)[];
  if (pub.platform === "youtube") {
    const kids = pub.meta.made_for_kids;
    steps = [
      { ...common.open, label: "Abre YouTube Studio → Crear → Subir videos" },
      common.video,
      { id: "title", label: "Título", hint: pub.title, action: { kind: "copy", text: pub.title, what: "Título" } },
      { id: "description", label: "Descripción (con hashtags y créditos)", action: { kind: "copy", text: pub.caption, what: "Descripción" } },
      {
        id: "thumbnail",
        label: "Miniatura: «Subir miniatura»",
        hint: reel ? "En los Shorts, YouTube deja cambiarla desde la app del móvil" : undefined,
        action: { kind: "reveal", file: "thumbnail", available: has.thumb },
      },
      {
        id: "kids",
        label: kids === null ? "Audiencia: decide si es contenido para niños" : `Audiencia: ${kids ? "Sí, es contenido para niños" : "No, no es contenido para niños"}`,
        hint: kids === null ? "Obligatorio: márcalo arriba para que quede anotado" : undefined,
        action: { kind: "info" },
      },
      tags ? { id: "tags", label: "«Mostrar más» → Etiquetas", action: { kind: "copy", text: tags, what: "Etiquetas" } } : null,
      pub.meta.synthetic ? { id: "synthetic", label: "«Mostrar más» → Contenido alterado: Sí", action: { kind: "info" } } : null,
      has.srt && pub.meta.captions
        ? { id: "subtitles", label: "Elementos del video → Subtítulos → Subir archivo (con tiempos)", action: { kind: "reveal", file: "subtitles", available: true } }
        : null,
      pub.scheduled_at ? scheduleStep(pub) : { id: "visibility", label: `Visibilidad: ${VISIBILITY[pub.visibility]}`, action: { kind: "info" } },
      common.pinned,
    ];
  } else if (pub.platform === "tiktok") {
    steps = [
      { ...common.open, label: "Abre TikTok Studio → Subir" },
      common.video,
      { id: "caption", label: "Descripción (título, texto y hashtags)", action: { kind: "copy", text: pub.caption, what: "Descripción" } },
      { id: "cover", label: "Portada: «Editar portada» → Subir imagen", action: { kind: "image", available: has.thumb } },
      scheduleStep(pub),
      common.credits,
      common.pinned,
    ];
  } else if (pub.platform === "instagram") {
    steps = [
      { ...common.open, label: "Abre Instagram → Crear → Reel" },
      common.video,
      { id: "cover", label: "Portada: «Añadir desde el ordenador»", action: { kind: "image", available: has.thumb } },
      { id: "caption", label: "Pie de foto (título, texto y hashtags)", action: { kind: "copy", text: pub.caption, what: "Texto" } },
      scheduleStep(pub),
      common.credits,
      common.pinned,
    ];
  } else {
    steps = [
      { ...common.open, label: `Abre Facebook → ${reel ? "Reel" : "Video"}` },
      common.video,
      { id: "title", label: "Título", hint: pub.title, action: { kind: "copy", text: pub.title, what: "Título" } },
      { id: "description", label: "Descripción (con hashtags y créditos)", action: { kind: "copy", text: pub.caption, what: "Descripción" } },
      { id: "thumbnail", label: "Miniatura", action: { kind: "reveal", file: "thumbnail", available: has.thumb } },
      scheduleStep(pub),
      common.pinned,
    ];
  }
  return steps.filter((s): s is KitStep => s !== null);
}

/** Todo en un solo bloque (por si se prefiere pegarlo en una nota). */
export function kitSummary(pub: Publication, state: PublishingState): string {
  const parts = [`${pub.label.toUpperCase()} — ${pub.title}`];
  if (pub.platform === "youtube" || pub.platform === "facebook") parts.push(`TÍTULO:\n${pub.title}`, `DESCRIPCIÓN:\n${pub.caption}`);
  else parts.push(`TEXTO:\n${pub.caption}`);
  if (pub.tags.length) parts.push(`ETIQUETAS:\n${pub.tags.join(", ")}`);
  if (pub.meta.pinned_comment) parts.push(`COMENTARIO FIJADO:\n${pub.meta.pinned_comment}`);
  if (pub.platform === "tiktok" || pub.platform === "instagram") {
    if (state.credits) parts.push(`CRÉDITOS (primer comentario):\n${state.credits}`);
  }
  if (pub.scheduled_at) parts.push(`PROGRAMAR: ${when(pub.scheduled_at)}`);
  if (state.video_file) parts.push(`VIDEO: ${state.video_file}`);
  return parts.join("\n\n");
}

export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado`);
    return true;
  } catch {
    toast.error("No se pudo copiar al portapapeles");
    return false;
  }
}

/** Copia la miniatura como imagen (PNG, lo que aceptan los portapapeles) para pegarla con Ctrl+V. */
async function copyImage(url: string): Promise<boolean> {
  try {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast.success("Miniatura copiada: pégala con Ctrl+V");
    return true;
  } catch {
    toast.error("No se pudo copiar la imagen: usa «Mostrar archivo»");
    return false;
  }
}

/**
 * Publicar a mano: los pasos de la plataforma con un botón para cada dato (copiar, mostrar el
 * archivo o copiar la imagen) y, al final, la dirección publicada.
 */
export function ManualKit({ pub, state, ctl }: { pub: Publication; state: PublishingState; ctl: PublishController }) {
  const openUrl = useOpenUrl();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [url, setUrl] = useState("");
  const steps = kitSteps(pub, state);
  const mark = (id: string, ok: boolean) => ok && setDone((d) => ({ ...d, [id]: true }));
  const thumb = coreUrl(pub.thumbnail_url);

  const run = async (step: KitStep) => {
    const a = step.action;
    if (a.kind === "open") {
      openUrl.mutate(pub.upload_url);
      mark(step.id, true);
    } else if (a.kind === "copy") mark(step.id, await copyText(a.text, a.what));
    else if (a.kind === "reveal") ctl.actions.reveal.mutate(a.file, { onSuccess: () => mark(step.id, true) });
    else if (a.kind === "image" && thumb) mark(step.id, await copyImage(thumb));
  };

  return (
    <div className="grid gap-3 rounded-md border p-3" aria-label={`Publicar a mano en ${pub.label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="size-4 text-brand" />
        <h4 className="min-w-0 flex-1 text-[13px] font-medium">Publicar a mano en {pub.label}</h4>
        <Button size="sm" variant="ghost" onClick={() => void copyText(kitSummary(pub, state), "Todo")}>
          <ClipboardCopy /> Copiar todo
        </Button>
      </div>
      <ol className="grid gap-1.5">
        {steps.map((step, i) => {
          const a = step.action;
          const available = !("available" in a) || a.available;
          return (
            <li key={step.id} className="flex items-start gap-2.5 text-[12px]" data-testid={`kit-${step.id}`}>
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                  done[step.id] ? "bg-success/20 text-success-foreground" : "bg-panel-2 text-muted-foreground",
                )}
              >
                {done[step.id] ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{step.label}</span>
                {step.hint && <span className="block truncate text-[11px] text-subtle" title={step.hint}>{step.hint}</span>}
                {!available && <span className="block text-[11px] text-warning">Todavía no hay archivo</span>}
              </span>
              {a.kind === "open" && (
                <Button size="sm" variant="outline" onClick={() => void run(step)}>
                  <ExternalLink /> Abrir
                </Button>
              )}
              {a.kind === "copy" && (
                <Button size="sm" variant="outline" aria-label={`Copiar: ${step.label}`} onClick={() => void run(step)}>
                  <Copy /> Copiar
                </Button>
              )}
              {a.kind === "reveal" && (
                <Button size="sm" variant="outline" disabled={!available} aria-label={`Mostrar archivo: ${step.label}`} onClick={() => void run(step)}>
                  <FolderOpen /> Mostrar archivo
                </Button>
              )}
              {a.kind === "image" && (
                <span className="flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={!available} onClick={() => void run(step)}>
                    <ImageIcon /> Copiar imagen
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!available} aria-label="Mostrar la miniatura" onClick={() => ctl.actions.reveal.mutate("thumbnail")}>
                    <FolderOpen />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
        <li className="flex flex-wrap items-center gap-2 border-t pt-2 text-[12px]">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[10px] text-muted-foreground">
            {steps.length + 1}
          </span>
          <Input
            aria-label={`Dirección publicada en ${pub.label}`}
            placeholder="Pega aquí la dirección cuando lo publiques"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-56 flex-1"
          />
          <Button
            size="sm"
            disabled={!url.trim() || ctl.actions.markPublished.isPending}
            onClick={() =>
              ctl.actions.markPublished.mutate({ id: pub.id, url: url.trim() }, { onSuccess: () => toast.success(`Marcado como publicado en ${pub.label}`) })
            }
          >
            <Check /> Marcar como publicado
          </Button>
        </li>
      </ol>
    </div>
  );
}
