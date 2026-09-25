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
import { useRestoreVersion, useScriptVersion, useScriptVersions } from "@/hooks/useScript";
import type { Script } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { cn } from "@/lib/utils";
import { TextDiff } from "./TextDiff";

export function sourceLabel(source: string | null): string {
  if (source === "claude") return "Claude";
  if (source === "manual") return "Edición manual";
  if (source?.startsWith("restore:")) return `Restaurada de ${source.slice(8)}`;
  return source ?? "—";
}

const joined = (s: Script | undefined | null) => s?.segments.map((x) => x.text).join("\n\n") ?? "";

export function VersionsDialog({
  open,
  onOpenChange,
  projectId,
  current,
  canRestore,
  restoreBlockedReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  current: Script | null | undefined;
  canRestore: boolean;
  restoreBlockedReason?: string;
}) {
  const { data: versions = [] } = useScriptVersions(projectId, open);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? versions[1]?.version ?? versions[0]?.version ?? null;
  const { data: other } = useScriptVersion(projectId, open ? selected : null);
  const restore = useRestoreVersion(projectId);
  const isCurrent = selected === current?.version;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col bg-panel p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Versiones del guion</DialogTitle>
          <DialogDescription>
            Cada guardado crea una versión. Compara cualquiera con la actual y restáurala si hace falta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 overflow-y-auto border-r p-2">
            {versions.map((v) => (
              <button
                key={v.version}
                type="button"
                onClick={() => setPicked(v.version)}
                className={cn(
                  "relative flex w-full flex-col rounded-md px-3 py-2.5 text-left",
                  selected === v.version
                    ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                    : "hover:bg-panel-2/60",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  Versión {v.version}
                  {v.version === current?.version && (
                    <span className="rounded bg-active px-1.5 text-[10px] text-active-foreground">
                      actual
                    </span>
                  )}
                  {v.status === "approved" && (
                    <span className="rounded bg-success px-1.5 text-[10px] text-success-foreground">
                      aprobada
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {sourceLabel(v.source)} · {formatDuration(v.total_est_s)} · {v.word_count} palabras
                </span>
                <span className="text-[11px] text-subtle">
                  {new Date(v.created_at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-5 text-[13px]">
              {isCurrent ? (
                <span className="text-muted-foreground">Es la versión actual.</span>
              ) : (
                <span className="text-muted-foreground">
                  Cambios de la versión {selected} a la actual (v{current?.version}):{" "}
                  <span className="text-success-foreground">agregado</span> ·{" "}
                  <span className="text-danger">quitado</span>
                </span>
              )}
              <Button
                className="ml-auto"
                size="sm"
                disabled={isCurrent || !canRestore || restore.isPending || selected == null}
                title={!canRestore ? restoreBlockedReason : undefined}
                onClick={() =>
                  selected != null &&
                  restore.mutate(selected, {
                    onSuccess: (s) => {
                      toast.success(`Versión ${selected} restaurada como versión ${s.version}`);
                      onOpenChange(false);
                    },
                  })
                }
              >
                Restaurar esta versión
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {isCurrent ? (
                <p className="selectable text-[14px] leading-relaxed whitespace-pre-wrap">{joined(current)}</p>
              ) : (
                <TextDiff before={joined(other)} after={joined(current)} />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
