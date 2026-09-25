import { Check, FileText, Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormatBadge, StatusBadge } from "@/components/projects/badges";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MediaBottomBar } from "@/features/media/MediaBottomBar";
import { MediaStage } from "@/features/media/MediaStage";
import { useMediaController } from "@/features/media/useMediaController";
import { ScenesBottomBar } from "@/features/scenes/ScenesBottomBar";
import { ScenesStage } from "@/features/scenes/ScenesStage";
import { useScenesGeneration } from "@/features/scenes/useScenesGeneration";
import { ScriptBottomBar } from "@/features/script/ScriptBottomBar";
import { ScriptStage } from "@/features/script/ScriptStage";
import { useScriptEditor } from "@/features/script/useScriptEditor";
import { useScriptGeneration } from "@/features/script/useScriptGeneration";
import { useDeleteProject, useProject, useUpdateProject } from "@/hooks/useProjects";
import { useScenes } from "@/hooks/useScenes";
import type { Project, ProjectUpdate } from "@/lib/api";
import {
  currentStage,
  FORMAT_LABEL,
  formatDate,
  formatDuration,
  PRIORITY_LABEL,
  STAGES,
  type StageId,
  stageState,
  STATUS_LABEL,
} from "@/lib/project";
import { cn } from "@/lib/utils";

type ViewId = "resumen" | StageId;

const STATE_TEXT = { pending: "Pendiente", active: "En curso", done: "Listo" } as const;

export function ProjectPage() {
  const id = Number(useParams().id);
  const { data: project, isError } = useProject(id);

  if (isError) {
    return (
      <PageLayout title="Proyecto">
        <EmptyState icon={FileText} title="El proyecto no existe" description="Puede que se haya eliminado." />
      </PageLayout>
    );
  }
  if (!project) return <PageLayout title="Proyecto">{null}</PageLayout>;
  return <ProjectView key={project.id} project={project} />;
}

const toDraft = (p: Project) => ({
  title: p.title,
  topic: p.topic ?? "",
  research_notes: p.research_notes ?? "",
  duration: p.format === "video" ? (p.target_duration_s ?? 0) / 60 : (p.target_duration_s ?? 0),
  target_publish_at: p.target_publish_at ?? "",
  priority: p.priority,
  tags: p.tags.join(", "),
});

function ProjectView({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewId>(currentStage(project.status)?.id ?? "resumen");
  const initial = toDraft(project);
  const [draft, setDraft] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject();
  const script = useScriptEditor(project);
  const generation = useScriptGeneration(project);
  const scenesGeneration = useScenesGeneration(project);
  const { data: scenesState } = useScenes(project.id);
  const media = useMediaController(project);

  // Salir del proyecto con cambios del guion sin guardar pide confirmación.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      script.dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = draft.title.trim().length > 0 && draft.duration > 0;
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const data: ProjectUpdate = {
      title: draft.title.trim(),
      topic: draft.topic.trim() || null,
      research_notes: draft.research_notes.trim() || null,
      target_duration_s: Math.round(project.format === "video" ? draft.duration * 60 : draft.duration),
      target_publish_at: draft.target_publish_at || null,
      priority: draft.priority,
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    update.mutate(data, { onSuccess: () => toast.success("Proyecto guardado") });
  };

  const stage = currentStage(project.status);
  const compactStages = view === "escenas" || view === "medios";
  return (
    <PageLayout
      title={project.title}
      actions={
        <div className="flex items-center gap-3 pr-2">
          <FormatBadge format={project.format} />
          <StatusBadge status={project.status} />
        </div>
      }
      bottomBar={
        view === "guion" ? (
          <ScriptBottomBar project={project} ctl={script} generation={generation} />
        ) : view === "escenas" ? (
          <ScenesBottomBar project={project} generation={scenesGeneration} />
        ) : view === "medios" ? (
          <MediaBottomBar project={project} ctl={media} />
        ) : (
          <BottomBar
            stats={[
              { label: "Etapa", value: stage?.label ?? "Publicado" },
              {
                label: "Duración objetivo",
                value: formatDuration(project.target_duration_s),
                highlight: true,
              },
              { label: "Publicación", value: formatDate(project.target_publish_at) },
            ]}
          >
            {view === "resumen" && dirty && (
              <Button variant="ghost" onClick={() => setDraft(initial)}>
                Descartar
              </Button>
            )}
            {view === "resumen" && (
              <Button
                size="lg"
                className="min-w-36"
                disabled={!dirty || !valid || update.isPending}
                onClick={save}
              >
                Guardar cambios
              </Button>
            )}
          </BottomBar>
        )
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* Etapas del proyecto (referencia 03, columna central) */}
        <div
          className={cn(
            "shrink-0 overflow-y-auto border-r p-2 transition-[width] duration-200",
            compactStages ? "w-14" : "w-72",
          )}
        >
          <StageButton
            compact={compactStages}
            active={view === "resumen"}
            onClick={() => setView("resumen")}
            icon={Info}
            label="Resumen"
            subtitle={`${project.channel_name} · ${FORMAT_LABEL[project.format]}`}
          />
          <div className="my-2 border-t" />
          {STAGES.map((s) => {
            const state = stageState(s, project.status);
            return (
              <StageButton
                compact={compactStages}
                key={s.id}
                active={view === s.id}
                onClick={() => setView(s.id)}
                icon={s.icon}
                label={s.label}
                subtitle={
                  s.id === "guion" && script.script
                    ? `${STATE_TEXT[state]} · v${script.script.version} · ${formatDuration(script.estimated)}${script.dirty ? " · sin guardar" : ""}`
                    : s.id === "guion" && generation.generating
                      ? "Generando…"
                      : s.id === "escenas" && scenesGeneration.running
                        ? "Generando…"
                        : s.id === "medios" && media.overview?.needing_media
                          ? `${STATE_TEXT[state]} · ${media.overview.with_media}/${media.overview.needing_media} con medio`
                          : s.id === "escenas" && scenesState?.scenes.length
                          ? `${STATE_TEXT[state]} · ${scenesState.scenes.length} escenas${scenesState.review_count ? ` · ${scenesState.review_count} por revisar` : ""}`
                          : STATE_TEXT[state]
                }
                indicator={
                  state === "done" ? (
                    <Check className="size-4 text-success-foreground" />
                  ) : state === "active" ? (
                    <span className="size-2 rounded-full bg-brand" />
                  ) : null
                }
                muted={state === "pending"}
              />
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {view !== "guion" && view !== "escenas" && view !== "medios" && (
            <div className="flex h-12 shrink-0 items-center border-b px-5">
              <span className="text-[13px] font-medium">
                {view === "resumen" ? "Resumen" : STAGES.find((s) => s.id === view)?.label}
              </span>
              <span className="ml-auto text-[12px] text-muted-foreground">
                {STATUS_LABEL[project.status]}
              </span>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {view === "resumen" ? (
              <div className="grid max-w-3xl gap-6 p-5">
                <FormField label="Título">
                  <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
                </FormField>
                <FormField label="Tema o caso">
                  <Textarea rows={2} value={draft.topic} onChange={(e) => set({ topic: e.target.value })} />
                </FormField>
                <FormField
                  label="Notas de investigación"
                  hint="Claude se basa en ellas y marca los datos que no estén aquí."
                >
                  <Textarea
                    rows={6}
                    value={draft.research_notes}
                    onChange={(e) => set({ research_notes: e.target.value })}
                  />
                </FormField>
                <div className="grid grid-cols-4 gap-4">
                  <FormField label={project.format === "video" ? "Duración (min)" : "Duración (s)"}>
                    <Input
                      type="number"
                      min={1}
                      value={draft.duration}
                      onChange={(e) => set({ duration: Number(e.target.value) })}
                    />
                  </FormField>
                  <FormField label="Publicación objetivo">
                    <Input
                      type="date"
                      value={draft.target_publish_at}
                      onChange={(e) => set({ target_publish_at: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Prioridad">
                    <Select
                      value={draft.priority.toString()}
                      onValueChange={(v) => set({ priority: Number(v) })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3].map((p) => (
                          <SelectItem key={p} value={p.toString()}>
                            {PRIORITY_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Etiquetas" hint="Separadas por comas">
                    <Input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
                  </FormField>
                </div>

                <div className="grid gap-2 rounded-md border p-4 text-[12px]">
                  <InfoRow label="Canal" value={project.channel_name} />
                  <InfoRow label="Formato" value={FORMAT_LABEL[project.format]} />
                  <InfoRow label="Carpeta" value={project.folder_path} mono />
                  <InfoRow label="Creado" value={formatDate(project.created_at)} />
                </div>

                <div>
                  <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 />
                    Eliminar proyecto
                  </Button>
                </div>
              </div>
            ) : view === "guion" ? (
              <ScriptStage project={project} ctl={script} generation={generation} />
            ) : view === "medios" ? (
              <MediaStage project={project} ctl={media} onGoToScenes={() => setView("escenas")} />
            ) : view === "escenas" ? (
              <ScenesStage
                project={project}
                generation={scenesGeneration}
                onGoToScript={() => setView("guion")}
              />
            ) : (
              <StagePlaceholder stageId={view} project={project} />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="Tienes cambios sin guardar en el guion"
        description="Si sales ahora se pierden. Puedes volver y guardarlos con Ctrl+S."
        confirmLabel="Salir sin guardar"
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Eliminar "${project.title}"?`}
        description="La carpeta del proyecto se mueve a la papelera (trash/ dentro de tu carpeta de datos)."
        confirmLabel="Eliminar proyecto"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(project.id, {
            onSuccess: () => {
              toast.success("Proyecto eliminado");
              navigate("/proyectos");
            },
          })
        }
      />
    </PageLayout>
  );
}

function StagePlaceholder({ stageId, project }: { stageId: StageId; project: Project }) {
  const stage = STAGES.find((s) => s.id === stageId)!;
  const state = stageState(stage, project.status);
  const previous = STAGES[STAGES.indexOf(stage) - 1];

  return (
    <EmptyState
      icon={stage.icon}
      title={state === "pending" ? `${stage.label}: pendiente` : stage.label}
      description={
        state === "pending" && previous
          ? `Se habilita cuando apruebes la etapa de ${previous.label.toLowerCase()}.`
          : "En construcción."
      }
    />
  );
}

function StageButton({
  active,
  onClick,
  icon: Icon,
  label,
  subtitle,
  indicator,
  muted,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Info;
  label: string;
  subtitle: string;
  indicator?: React.ReactNode;
  muted?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={compact ? `${label} · ${subtitle}` : undefined}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        compact && "justify-center px-0",
        active
          ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
          : "hover:bg-panel-2/60",
      )}
    >
      <Icon
        className={cn("size-[18px] shrink-0", muted ? "text-subtle" : "text-muted-foreground")}
        strokeWidth={1.6}
      />
      {!compact && (
        <>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[13px] font-medium", muted && "text-muted-foreground")}>
              {label}
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">{subtitle}</span>
          </span>
          {indicator}
        </>
      )}
    </button>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("selectable min-w-0 truncate", mono && "font-mono text-[11px]")} title={value}>
        {value}
      </span>
    </div>
  );
}
