import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  FolderInput,
  Link2Off,
  MoreHorizontal,
  Send,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useOpenUrl, useRevealProject } from "@/hooks/useManualMedia";
import { usePublishingActions } from "@/hooks/usePublishing";
import type { Project, PublishPlatform } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PLATFORM_TONE } from "@/features/publishing/publishingMeta";

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

type Badge = NonNullable<Project["publications"]>[number];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Lee el portapapeles si el sistema lo permite (en la ventana de la app suele poder). */
async function readClipboard(): Promise<string> {
  try {
    return (await navigator.clipboard?.readText())?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * Menú ⋯ de un proyecto en la lista: enlaces por plataforma (pegar, abrir, copiar, quitar),
 * carpetas y archivos, y eliminar, sin tener que abrir el proyecto.
 */
export function ProjectMenu({
  project,
  onDelete,
  className,
}: {
  project: Project;
  onDelete: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const openUrl = useOpenUrl();
  const revealProject = useRevealProject();
  const actions = usePublishingActions(project.id);
  const [linkFor, setLinkFor] = useState<{ badge: Badge; initial: string } | null>(null);
  const pubs = (project.publications ?? []).filter((p) => p.id != null);

  const pasteLink = async (badge: Badge) => {
    const clip = await readClipboard();
    setLinkFor({ badge, initial: /^https?:\/\//.test(clip) ? clip : (badge.url ?? "") });
  };
  const copy = (text: string, what: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`${what} copiado`))
      .catch(() => toast.error("No se pudo copiar"));
  const revealVideo = () =>
    actions.reveal.mutate("video", { onError: (e) => toast.error(errorText(e)) });

  // Los clics del menú y del diálogo (van en un portal) no deben abrir el proyecto de la fila.
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <span className="contents" onClick={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Opciones de ${project.title}`}
            title="Opciones"
            className={cn(
              "rounded p-1.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 hover:bg-panel-2 hover:text-foreground focus-visible:opacity-100 data-[state=open]:bg-panel-2 data-[state=open]:opacity-100",
              className,
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => navigate(`/proyectos/${project.id}`)}>
            <SquareArrowOutUpRight /> Abrir proyecto
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(`/proyectos/${project.id}?etapa=publicacion`)}>
            <Send /> Ir a Publicación
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Enlaces publicados</DropdownMenuLabel>
          {pubs.length === 0 && (
            <DropdownMenuItem disabled className="text-[12px]">
              Abre Publicación una vez para crear las plataformas
            </DropdownMenuItem>
          )}
          {pubs.map((p) => {
            const label = PLATFORM_LABEL[p.platform] ?? p.platform;
            return (
              <DropdownMenuSub key={p.platform}>
                <DropdownMenuSubTrigger className="gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      p.url ? PLATFORM_TONE[p.platform as PublishPlatform] : "bg-panel-2 ring-1 ring-border",
                    )}
                  />
                  {label}
                  <span className="ml-auto text-[11px] text-muted-foreground">{p.url ? "con enlace" : "sin enlace"}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuItem disabled={!p.url} onSelect={() => p.url && openUrl.mutate(p.url)}>
                    <ExternalLink /> Abrir en {label}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void pasteLink(p)}>
                    <ClipboardPaste /> {p.url ? "Cambiar enlace…" : "Pegar enlace…"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!p.url} onSelect={() => p.url && copy(p.url, "Enlace")}>
                    <Copy /> Copiar enlace
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!p.url}
                    variant="destructive"
                    onSelect={() =>
                      actions.reopen.mutate(p.id!, {
                        onSuccess: () => toast.success(`${label}: enlace quitado, vuelve a pendiente`),
                        onError: (e) => toast.error(errorText(e)),
                      })
                    }
                  >
                    <Link2Off /> Quitar enlace
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={revealVideo}>
            <FolderSearch /> Mostrar el video renderizado
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => revealProject.mutate(project.id, { onError: (e) => toast.error(errorText(e)) })}
          >
            <FolderOpen /> Abrir carpeta del proyecto
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => actions.reveal.mutate(undefined, { onError: (e) => toast.error(errorText(e)) })}
          >
            <FolderInput /> Abrir carpeta de publicación
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(project.title, "Título")}>
            <Copy /> Copiar título
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Eliminar proyecto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {linkFor && (
        <LinkDialog
          projectId={project.id}
          badge={linkFor.badge}
          initial={linkFor.initial}
          onClose={() => setLinkFor(null)}
        />
      )}
    </span>
  );
}

/** Pegar la dirección de la publicación: la plataforma queda como publicada. */
function LinkDialog({
  projectId,
  badge,
  initial,
  onClose,
}: {
  projectId: number;
  badge: Badge;
  initial: string;
  onClose: () => void;
}) {
  const { markPublished } = usePublishingActions(projectId);
  const [url, setUrl] = useState(initial);
  const label = PLATFORM_LABEL[badge.platform] ?? badge.platform;
  const valid = /^https?:\/\/\S+$/.test(url.trim());

  const save = () =>
    markPublished.mutate(
      { id: badge.id!, url: url.trim() },
      {
        onSuccess: () => {
          toast.success(`${label}: enlace guardado`);
          onClose();
        },
        onError: (e) => toast.error(errorText(e)),
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enlace de {label}</DialogTitle>
          <DialogDescription>
            Pega la dirección del video publicado. {label} quedará como publicado en este proyecto.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save();
          }}
        >
          <Input
            autoFocus
            aria-label={`Enlace de ${label}`}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {url.trim() && !valid && (
            <p className="mt-1.5 text-[12px] text-danger">Pega la dirección completa (https://…)</p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || markPublished.isPending}>
              Guardar enlace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
