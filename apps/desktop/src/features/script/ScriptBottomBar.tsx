import { LoaderCircle, Sparkles, Unlock } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BottomBar } from "@/components/layout/BottomBar";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { cn } from "@/lib/utils";
import { durationTone } from "./doc";
import type { ScriptEditorController } from "./useScriptEditor";
import type { ScriptGeneration } from "./useScriptGeneration";

// Semáforo contra la duración objetivo: ±10 % verde, ±25 % ámbar, más rojo.
const TONE = { ok: "text-success-foreground", warn: "text-warning", bad: "text-danger" };

export function ScriptBottomBar({
  project,
  ctl,
  generation,
}: {
  project: Project;
  ctl: ScriptEditorController;
  generation: ScriptGeneration;
}) {
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const target = formatDuration(project.target_duration_s);
  const hasContent = !!ctl.script || ctl.dirty;

  if (generation.generating || !hasContent) {
    return (
      <BottomBar
        stats={[
          { label: "Etapa", value: "Guion" },
          { label: "Duración objetivo", value: target, highlight: true },
        ]}
      >
        <Button size="lg" disabled={generation.generating} onClick={generation.start}>
          {generation.generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {generation.generating ? "Generando guion…" : "Generar guion con Claude"}
        </Button>
      </BottomBar>
    );
  }

  const stats = [
    { label: "Guion", value: ctl.script ? `v${ctl.script.version}` : "nuevo" },
    {
      label: "Duración estimada",
      value: (
        <span className={cn("font-mono", TONE[durationTone(ctl.estimated, project.target_duration_s)])}>
          {formatDuration(ctl.estimated)} <span className="text-subtle">/ {target}</span>
        </span>
      ),
    },
    {
      label: "Por verificar",
      value: <span className={ctl.factChecks ? "text-warning" : undefined}>{ctl.factChecks}</span>,
    },
  ];

  if (ctl.locked) {
    return (
      <BottomBar stats={stats}>
        <Button variant="outline" disabled={ctl.unlocking} onClick={() => setConfirmUnlock(true)}>
          <Unlock /> Desbloquear
        </Button>
        <Button size="lg" disabled>
          Guion aprobado
        </Button>
        <ConfirmDialog
          open={confirmUnlock}
          onOpenChange={setConfirmUnlock}
          title="¿Desbloquear el guion?"
          description="Podrás editarlo otra vez. Las escenas de los segmentos que cambies quedarán marcadas para revisar; el resto se conserva."
          confirmLabel="Desbloquear"
          onConfirm={() => {
            setConfirmUnlock(false);
            void ctl.unlock().catch(() => {});
          }}
        />
      </BottomBar>
    );
  }

  return (
    <BottomBar stats={stats}>
      {ctl.dirty && ctl.script && (
        <Button variant="ghost" onClick={ctl.discard}>
          Descartar
        </Button>
      )}
      <Button
        variant="outline"
        disabled={!ctl.dirty || ctl.saving || !!ctl.pending}
        title="Ctrl+S"
        onClick={() => void ctl.save().catch(() => {})}
      >
        Guardar
      </Button>
      <Button
        size="lg"
        className="min-w-40"
        disabled={ctl.approving || ctl.saving || !!ctl.pending}
        title="Ctrl+Enter"
        onClick={() => void ctl.approve().catch(() => {})}
      >
        Aprobar guion
      </Button>
    </BottomBar>
  );
}
