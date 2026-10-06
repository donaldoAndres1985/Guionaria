import { HardDrive } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSettings } from "@/hooks/useCore";
import { useBackupProjects, useBackupStatus, useCleanupMedia } from "@/hooks/useStorage";
import type { CleanablePart, StorageNode, StorageUsage } from "@/lib/api";
import { formatSize } from "./treemap";

const PARTS: { key: CleanablePart; label: string; hint: string }[] = [
  { key: "render", label: "Render", hint: "El video final ya exportado (la portada se conserva)" },
  { key: "approved", label: "Aprobados", hint: "Videos e imágenes elegidos para las escenas" },
  { key: "manual", label: "Agregados a mano", hint: "Material real que subiste tú" },
  { key: "audio", label: "Voz", hint: "La narración generada" },
  { key: "timeline", label: "Timeline y subtítulos", hint: "Archivos intermedios del armado" },
];

interface ProjectRow {
  project_id: number;
  title: string;
  channel_name: string;
  parts: Record<string, StorageNode>;
}

function projectRows(usage: StorageUsage | undefined): ProjectRow[] {
  if (!usage) return [];
  const out: ProjectRow[] = [];
  for (const channel of usage.tree.children) {
    if (channel.kind !== "channel") continue;
    for (const project of channel.children) {
      if (project.kind !== "project" || project.project_id == null) continue;
      const parts: Record<string, StorageNode> = {};
      for (const part of project.children) {
        const key = part.id.split(":")[1];
        if (key) parts[key] = part;
      }
      out.push({ project_id: project.project_id, title: project.name, channel_name: channel.name, parts });
    }
  }
  return out;
}

/** Limpieza completa (sección 5.11): borra del disco lo usado para hacer el video (render,
 * medios aprobados, voz…) de los proyectos que elijas. A diferencia de «Liberar espacio», esto
 * sí toca material usado, no solo candidatos descartados: el usuario elige qué y cuándo. */
export function FullCleanupDialog({ open, usage, onClose }: { open: boolean; usage: StorageUsage | undefined; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-panel sm:max-w-2xl">
        {open && usage && <FullCleanupForm usage={usage} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function FullCleanupForm({ usage, onClose }: { usage: StorageUsage; onClose: () => void }) {
  const cleanup = useCleanupMedia();
  const backupNow = useBackupProjects();
  const settings = useSettings();
  const backupStatus = useBackupStatus();
  const navigate = useNavigate();
  const backupReady = !!backupStatus.data?.ok;
  // null: lo que diga Ajustes («Copiar antes de borrar el render»), hasta que el usuario lo toque.
  const [backupChoice, setBackupChoice] = useState<boolean | null>(null);
  const backup = backupReady && (backupChoice ?? settings.data?.backup?.before_cleanup ?? true);
  const [parts, setParts] = useState<Set<CleanablePart>>(new Set());
  const [projects, setProjects] = useState<Set<number>>(new Set());
  const rows = useMemo(() => projectRows(usage), [usage]);

  const togglePart = (key: CleanablePart) =>
    setParts((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleProject = (id: number) =>
    setProjects((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bytesFor = (row: ProjectRow) =>
    [...parts].reduce((n, key) => n + (row.parts[key]?.bytes ?? 0), 0);
  const filesFor = (row: ProjectRow) =>
    [...parts].reduce((n, key) => n + (row.parts[key]?.files ?? 0), 0);
  const visible = rows.filter((r) => parts.size > 0 && bytesFor(r) > 0);
  const chosen = visible.filter((r) => projects.has(r.project_id));
  const totalBytes = chosen.reduce((n, r) => n + bytesFor(r), 0);
  const totalFiles = chosen.reduce((n, r) => n + filesFor(r), 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Limpieza completa</DialogTitle>
        <DialogDescription>
          Borra del disco el material ya usado para hacer el video: render, medios aprobados, voz o archivos
          intermedios. Úsalo en proyectos terminados o publicados; si hace falta reeditar, la app avisará del
          archivo que falta.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        {PARTS.map((p) => (
          <label
            key={p.key}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] hover:bg-panel-2/60"
            title={p.hint}
          >
            <input type="checkbox" checked={parts.has(p.key)} onChange={() => togglePart(p.key)} aria-label={p.label} />
            {p.label}
          </label>
        ))}
      </div>

      {parts.size === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-[13px] text-muted-foreground">
          Elige arriba qué borrar para ver los proyectos.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-[13px] text-muted-foreground">
          Ningún proyecto tiene archivos en lo elegido.
        </p>
      ) : (
        <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {visible.map((r) => (
            <label key={r.project_id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-panel-2/60">
              <input type="checkbox" checked={projects.has(r.project_id)} onChange={() => toggleProject(r.project_id)} aria-label={r.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block text-[12px] text-muted-foreground">{r.channel_name}</span>
              </span>
              <span className="text-right text-[12px]">
                <span className="block font-medium">{formatSize(bytesFor(r))}</span>
                <span className="block text-muted-foreground">{filesFor(r)} archivos</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {parts.has("render") && (
        <div className="flex min-w-0 items-start gap-3 rounded-md border bg-panel-2/40 px-3 py-2.5 text-[12px]" data-testid="cleanup-backup">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {backupReady ? (
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={backup}
                onChange={(e) => setBackupChoice(e.target.checked)}
                aria-label="Copiar el video final y la portada a la copia de seguridad"
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px]">Copiar antes el video final y la portada</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground" title={backupStatus.data?.folder}>
                  {backupStatus.data?.folder}
                </span>
              </span>
            </label>
          ) : (
            <span className="flex-1 text-muted-foreground">
              {backupStatus.data?.folder
                ? `La carpeta de copia de seguridad no está disponible: ${backupStatus.data.detail ?? ""}`
                : "Configura una carpeta de copia de seguridad (Google Drive, OneDrive o un disco) para guardar el video y la portada antes de borrarlos."}{" "}
              <button
                type="button"
                className="text-foreground underline-offset-2 hover:underline"
                onClick={() => navigate("/ajustes?categoria=folders")}
              >
                Ir a Ajustes
              </button>
            </span>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        {backupReady && parts.has("render") && (
          <Button
            variant="outline"
            disabled={!chosen.length || backupNow.isPending || cleanup.isPending}
            onClick={() =>
              backupNow.mutate(
                chosen.map((r) => r.project_id),
                {
                  onSuccess: (r) =>
                    toast.success(
                      r.copied
                        ? `Copia de seguridad lista: ${r.copied} archivos (${formatSize(r.bytes)})`
                        : "La copia de seguridad ya estaba al día",
                    ),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            Solo copiar
          </Button>
        )}
        <Button
          variant="destructive"
          disabled={!chosen.length || cleanup.isPending}
          onClick={() =>
            cleanup.mutate(
              { projectIds: chosen.map((r) => r.project_id), parts: [...parts], backup: backup && parts.has("render") },
              {
                onError: (e) => toast.error(e.message),
                onSuccess: (r) => {
                  toast.success(
                    `Se liberaron ${formatSize(r.freed_bytes)} (${r.deleted} archivos)` +
                      (backup && parts.has("render") ? " · copia de seguridad guardada" : ""),
                  );
                  setProjects(new Set());
                  onClose();
                },
              },
            )
          }
        >
          {backup && parts.has("render") ? "Copiar y borrar" : "Borrar"} {totalFiles} archivos · {formatSize(totalBytes)}
        </Button>
      </DialogFooter>
    </>
  );
}
