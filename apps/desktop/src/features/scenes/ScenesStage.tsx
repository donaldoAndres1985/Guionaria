import { Clapperboard, Download, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner, JobProgress, NoticeBanner } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type SceneAction,
  useExportScenes,
  useReorderScenes,
  useSceneAction,
  useScenes,
  useUpdateScene,
} from "@/hooks/useScenes";
import type { Project, SceneUpdate } from "@/lib/api";
import { STATUS_ORDER } from "@/lib/project";
import { cn } from "@/lib/utils";
import { ScenesTable } from "./ScenesTable";
import { filterScenes, type KindFilter, KINDS, kindCounts } from "./sceneMeta";
import type { ScenesGeneration } from "./useScenesGeneration";

const scriptApproved = (p: Project) =>
  STATUS_ORDER.indexOf(p.status) >= STATUS_ORDER.indexOf("GUION_APROBADO");

export function ScenesStage({
  project,
  generation,
  onGoToScript,
}: {
  project: Project;
  generation: ScenesGeneration;
  onGoToScript: () => void;
}) {
  const { data: state, isPending } = useScenes(project.id);
  const update = useUpdateScene(project.id);
  const reorder = useReorderScenes(project.id);
  const action = useSceneAction(project.id);
  const exportScenes = useExportScenes(project.id);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [confirmAll, setConfirmAll] = useState(false);

  const onUpdate = useCallback(
    (id: number, data: SceneUpdate) => update.mutate({ id, data }),
    [update.mutate], // mutate es estable: la tabla no se recrea en cada render
  );
  const onAction = useCallback(
    (id: number, a: SceneAction) =>
      action.mutate(
        { id, action: a },
        { onSuccess: () => a === "delete" && toast.success("Escena eliminada") },
      ),
    [action.mutate],
  );

  if (generation.running) {
    return (
      <JobProgress
        job={generation.job}
        fallback="Enviando el guion a Claude…"
        hint="Claude arma la tabla de escenas a partir del guion aprobado. Suele tardar entre 30 y 120 segundos."
      />
    );
  }
  if (isPending || !state) return null;

  const errorBanner = generation.error && (
    <ErrorBanner
      message={`No se pudieron generar las escenas: ${generation.error}`}
      onClose={generation.dismissError}
    />
  );

  if (state.scenes.length === 0) {
    const ready = scriptApproved(project);
    return (
      <div className="flex flex-1 flex-col">
        {errorBanner}
        <EmptyState
          icon={Clapperboard}
          title={ready ? "Sin escenas todavía" : "Primero aprueba el guion"}
          description={
            ready
              ? "Claude convertirá el guion en una tabla de escenas: tipo de medio, descripción visual, búsquedas, efectos, texto en pantalla y SFX. Los tiempos los calcula la app."
              : "Las escenas se generan a partir del guion aprobado."
          }
          action={
            ready ? (
              <Button onClick={() => generation.start("all")}>
                <Sparkles /> Generar escenas con Claude
              </Button>
            ) : (
              <Button variant="outline" onClick={onGoToScript}>
                Ir al guion
              </Button>
            )
          }
        />
      </div>
    );
  }

  const counts = kindCounts(state.scenes);
  const visible = filterScenes(state.scenes, filter);
  const pending = state.review_count + state.segments_without_scenes.length;
  const canRegenerate = state.editable;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {errorBanner}

      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {(["all", ...KINDS.map((k) => k.id)] as KindFilter[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-3 text-[13px] transition-colors",
              filter === id
                ? "bg-active font-medium text-active-foreground"
                : "text-muted-foreground hover:bg-panel-2 hover:text-foreground",
            )}
          >
            {id === "all" ? "Todas" : KINDS.find((k) => k.id === id)!.label}
            <span className="text-[11px] opacity-80">{counts[id]}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-0.5">
          {canRegenerate && pending > 0 && (
            <Button variant="outline" size="sm" onClick={() => generation.start("pending")}>
              <Sparkles /> Regenerar pendientes ({pending})
            </Button>
          )}
          {canRegenerate && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmAll(true)}>
              <RefreshCw /> Regenerar todo
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Download /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["md", "csv"] as const).map((fmt) => (
                <DropdownMenuItem
                  key={fmt}
                  onSelect={() =>
                    exportScenes.mutate(fmt, {
                      onSuccess: (r) => toast.success("Tabla exportada", { description: r.path }),
                    })
                  }
                >
                  {fmt === "md" ? "Markdown (escenas.md)" : "CSV para Excel (escenas.csv)"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!state.editable && !state.approved && (
        <NoticeBanner
          action={
            <Button size="sm" variant="ghost" onClick={onGoToScript}>
              Ir al guion
            </Button>
          }
        >
          El guion está desbloqueado: apruébalo para volver a editar las escenas.
        </NoticeBanner>
      )}
      {state.editable && pending > 0 && (
        <NoticeBanner>
          {state.review_count > 0 &&
            `${state.review_count} escenas por revisar porque cambió su segmento del guion. `}
          {state.segments_without_scenes.length > 0 &&
            `Segmentos sin escenas: ${state.segments_without_scenes.join(", ")}. `}
          Edítalas, márcalas como revisadas o usa «Regenerar pendientes».
        </NoticeBanner>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <ScenesTable
          scenes={visible}
          editable={state.editable}
          reorderable={state.editable && filter === "all"}
          grouped={filter === "all"}
          onUpdate={onUpdate}
          onReorder={(ids) => reorder.mutate(ids)}
          onAction={onAction}
        />
      </div>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="¿Regenerar todas las escenas?"
        description="Claude rehace la tabla completa y se pierden tus ediciones de escenas. Si solo cambió parte del guion, usa «Regenerar pendientes»."
        confirmLabel="Regenerar todo"
        destructive
        onConfirm={() => {
          setConfirmAll(false);
          generation.start("all");
        }}
      />
    </div>
  );
}
