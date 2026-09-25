import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  History,
  LoaderCircle,
  Lock,
  PenLine,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner, JobProgress } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@/lib/api";
import { formatDuration } from "@/lib/project";
import { TextDiff } from "./TextDiff";
import type { ScriptEditorController } from "./useScriptEditor";
import type { ScriptGeneration } from "./useScriptGeneration";
import { sourceLabel, VersionsDialog } from "./VersionsDialog";

const QUICK_INSTRUCTIONS = ["Más corto", "Más dramático", "Más claro", "Agrega un dato de las notas"];


export function ScriptStage({
  project,
  ctl,
  generation,
}: {
  project: Project;
  ctl: ScriptEditorController;
  generation: ScriptGeneration;
}) {
  const [manual, setManual] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Atajos: Ctrl+S guarda, Ctrl+Enter aprueba (sección 15.4). La ref evita re-suscribirse en cada render.
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ctlRef.current;
      if (!(e.ctrlKey || e.metaKey) || c.locked || c.pending) return;
      if (e.key === "s") {
        e.preventDefault();
        if (c.dirty) void c.save().catch(() => {});
      } else if (e.key === "Enter" && (c.script || c.dirty)) {
        e.preventDefault();
        void c.approve().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (generation.generating) {
    return (
      <JobProgress
        job={generation.job}
        fallback="Enviando a Claude…"
        hint="Suele tardar entre 20 y 90 segundos. Puedes seguir usando la app: el guion aparecerá aquí al terminar."
      />
    );
  }
  if (ctl.isPending) return null;

  if (!ctl.script && !manual && !ctl.dirty) {
    return (
      <div className="flex flex-1 flex-col">
        {generation.error && (
          <ErrorBanner
            message={`No se pudo generar el guion: ${generation.error}`}
            onClose={generation.dismissError}
          />
        )}
        <EmptyState
          icon={PenLine}
          title="Sin guion todavía"
          description={`Claude escribirá un guion de ${formatDuration(project.target_duration_s)} a partir del tema, tus notas y el estilo del canal. También puedes escribirlo a mano.`}
          action={
            <div className="flex gap-2">
              <Button onClick={generation.start}>
                <Sparkles />
                Generar con Claude
              </Button>
              <Button variant="outline" onClick={() => setManual(true)}>
                Escribir a mano
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const sections = ctl.script?.sections ?? [];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {generation.error && <ErrorBanner
            message={`No se pudo generar el guion: ${generation.error}`}
            onClose={generation.dismissError}
          />}

      {/* Barra de herramientas del guion (hace de cabecera del panel) */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-3 pl-5 text-[12px] whitespace-nowrap">
        {ctl.locked ? (
          <span className="flex items-center gap-1.5 text-success-foreground">
            <Lock className="size-3.5" /> Aprobado · versión {ctl.script?.version}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">
            <span className="font-medium text-foreground">Guion</span>
            {" · "}
            {ctl.script ? `versión ${ctl.script.version} · ${sourceLabel(ctl.script.source)}` : "nuevo"}
            {ctl.dirty && <span className="text-warning"> · sin guardar</span>}
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {!ctl.locked && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!!ctl.pending}
              title="Reescribir con Claude el segmento donde está el cursor (o selecciona un fragmento)"
              onClick={() => void ctl.startRewrite().catch(() => {})}
            >
              <Sparkles /> Reescribir
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!ctl.script} onClick={() => setVersionsOpen(true)}>
            <History /> Versiones
          </Button>
          {!ctl.locked && ctl.script && (
            <Button
              variant="ghost"
              size="sm"
              disabled={ctl.dirty}
              title={ctl.dirty ? "Guarda o descarta tus cambios antes de regenerar" : "Pedir un guion nuevo a Claude"}
              onClick={() => setConfirmRegenerate(true)}
            >
              <RefreshCw /> Regenerar
            </Button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={ctl.editor} className="mx-auto max-w-3xl" />
      </div>

      {ctl.editor && !ctl.locked && (
        <BubbleMenu
          editor={ctl.editor}
          shouldShow={({ state }) => !state.selection.empty && !ctl.pending}
          className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-lg"
        >
          <BubbleButton onClick={() => void ctl.startRewrite().catch(() => {})}>
            <Sparkles className="size-3.5 text-brand" /> Reescribir…
          </BubbleButton>
          {QUICK_INSTRUCTIONS.slice(0, 2).map((instruction) => (
            <BubbleButton
              key={instruction}
              onClick={async () => {
                const target = await ctl.startRewrite().catch(() => null);
                if (target) await ctl.requestRewrite(instruction, target).catch(() => {});
              }}
            >
              {instruction}
            </BubbleButton>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <BubbleButton onClick={() => ctl.editor?.chain().focus().toggleFactCheck().run()}>
            <TriangleAlert className="size-3.5 text-warning" /> Verificar
          </BubbleButton>
          {sections.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded px-2 py-1 text-[12px] hover:bg-panel">
                  Sección ▾
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {sections.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() => ctl.editor?.chain().focus().setSection(s).run()}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </BubbleMenu>
      )}

      {ctl.pending && <RewritePanel ctl={ctl} />}

      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        projectId={project.id}
        current={ctl.script}
        canRestore={!ctl.locked && !ctl.dirty}
        restoreBlockedReason={
          ctl.locked ? "Desbloquea el guion para restaurar" : "Guarda o descarta tus cambios primero"
        }
      />
      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="¿Regenerar el guion con Claude?"
        description="Claude escribirá un guion nuevo. El actual queda guardado en Versiones y puedes restaurarlo."
        confirmLabel="Regenerar"
        onConfirm={() => {
          setConfirmRegenerate(false);
          generation.start();
        }}
      />
    </div>
  );
}

function BubbleButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // no perder la selección
      onClick={onClick}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] whitespace-nowrap hover:bg-panel"
    >
      {children}
    </button>
  );
}

function RewritePanel({ ctl }: { ctl: ScriptEditorController }) {
  const [instruction, setInstruction] = useState("");
  const pending = ctl.pending!;
  const ask = (text: string) => {
    setInstruction(text);
    void ctl.requestRewrite(text).catch(() => {});
  };

  return (
    <div className="absolute inset-x-6 bottom-4 z-20 rounded-lg border bg-popover p-4 shadow-2xl">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
        <Sparkles className="size-4 text-brand" />
        Reescribir con Claude
        <span className="font-mono text-[11px] font-normal text-subtle">{pending.segKey}</span>
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={ctl.cancelRewrite}
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </div>

      {pending.result ? (
        <>
          <div className="max-h-40 overflow-y-auto rounded-md bg-background p-3">
            <TextDiff before={pending.fragment} after={pending.result.texto} />
          </div>
          {pending.result.verificar_dato && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warning">
              <TriangleAlert className="size-3.5" />
              Incluye un dato que no está en tus notas: quedará marcado para verificar.
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={ctl.cancelRewrite}>
              Descartar
            </Button>
            <Button variant="outline" onClick={() => ask(instruction || "Otra versión")}>
              Otra versión
            </Button>
            <Button onClick={ctl.acceptRewrite}>Aceptar</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 line-clamp-3 rounded-md bg-background p-3 text-[13px] text-muted-foreground">
            “{pending.fragment}”
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) ask(instruction.trim());
            }}
          >
            <input
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={ctl.rewriting}
              placeholder="Qué cambiar: más corto, cambia el tono, agrega la fecha…"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button type="submit" disabled={ctl.rewriting || !instruction.trim()}>
              {ctl.rewriting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {ctl.rewriting ? "Claude está reescribiendo…" : "Pedir a Claude"}
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_INSTRUCTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={ctl.rewriting}
                onClick={() => ask(q)}
                className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:bg-panel-2 hover:text-foreground disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
