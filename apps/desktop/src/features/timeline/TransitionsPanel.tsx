import { Blend } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KIND_LABEL } from "@/features/scenes/sceneMeta";
import { useSaveTransitions, useTransitions } from "@/hooks/useTransitions";
import type { TransitionCut, TransitionsState } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pct } from "./timelineMeta";

const DEFAULT = "__default__"; // en el selector de un corte: volver a la de por defecto

export const transitionLabel = (state: TransitionsState | undefined, id: string | null) =>
  id ? (state?.options.find((o) => o.id === id)?.label ?? id) : "Corte directo";

export function transitionsSummary(state: TransitionsState | undefined): string {
  if (!state) return "";
  const used = state.cuts.filter((c) => c.transition).length;
  if (!used) return "Cortes directos";
  return `${transitionLabel(state, state.default === "none" ? null : state.default)} · ${used} de ${state.cuts.length}`;
}

/** Selector de la transición de un corte (con la opción de usar la de por defecto). */
function CutSelect({ state, cut, onChange, disabled }: { state: TransitionsState; cut: TransitionCut; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <Select value={cut.chosen ?? DEFAULT} disabled={disabled} onValueChange={(v) => onChange(v === DEFAULT ? null : v)}>
      <SelectTrigger className="h-8 w-full text-[12px]" aria-label={`Transición después de la escena ${cut.position}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>Por defecto ({transitionLabel(state, state.default === "none" ? null : state.default)})</SelectItem>
        {state.options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Transiciones entre escenas: la de por defecto (para todos los cortes), su duración y la de
 * cada corte, para cualquier combinación (video → imagen, imagen → texto…).
 */
export function TransitionsPanel({ projectId, disabled }: { projectId: number; disabled?: boolean }) {
  const { data: state } = useTransitions(projectId);
  const { prefs, cut } = useSaveTransitions(projectId);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => setDuration(null), [state?.duration]);
  if (!state) return null;
  const shown = duration ?? state.duration;
  const overridden = state.cuts.some((c) => c.chosen !== null);

  return (
    <div className="grid gap-3 text-[12px]" aria-label="Transiciones">
      <label className="grid gap-1 text-muted-foreground">
        Transición por defecto (todos los cortes)
        <Select value={state.default} disabled={disabled} onValueChange={(v) => prefs.mutate({ default: v })}>
          <SelectTrigger className="w-full" aria-label="Transición por defecto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {state.options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="grid gap-1 text-muted-foreground">
        <span className="flex justify-between">
          Duración <span className="font-mono text-foreground">{shown.toFixed(1)} s</span>
        </span>
        <input
          type="range"
          aria-label="Duración de la transición"
          min={0.2}
          max={1.5}
          step={0.1}
          value={shown}
          disabled={disabled}
          onChange={(e) => setDuration(Number(e.target.value))}
          onPointerUp={() => duration !== null && prefs.mutate({ duration })}
          onKeyUp={() => duration !== null && prefs.mutate({ duration })}
          className="accent-[var(--accent)]"
        />
        <span className="text-[11px] text-subtle">En escenas cortas se acorta sola. El video dura lo mismo: la voz no se desfasa.</span>
      </label>

      {overridden && (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => prefs.mutate({ reset_cuts: true })}>
          Aplicar la de por defecto a todos los cortes
        </Button>
      )}

      <div className="grid gap-2">
        <span className="text-muted-foreground">Cada corte</span>
        {state.cuts.map((c) => (
          <div key={c.scene_id} className="grid gap-1" data-testid={`cut-${c.position}`}>
            <span className={cn("text-[11px]", c.chosen ? "text-foreground" : "text-subtle")}>
              {c.position} → {c.position + 1} · {KIND_LABEL[c.from_kind] ?? c.from_kind} → {KIND_LABEL[c.to_kind] ?? c.to_kind}
            </span>
            <CutSelect state={state} cut={c} disabled={disabled} onChange={(v) => cut.mutate({ sceneId: c.scene_id, transition: v })} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Marcas de los cortes sobre la pista de video: clic para elegir la transición de ese corte. */
export function CutMarkers({ projectId, duration, disabled }: { projectId: number; duration: number; disabled?: boolean }) {
  const { data: state } = useTransitions(projectId);
  const { cut } = useSaveTransitions(projectId);
  if (!state || !duration) return null;
  return (
    <>
      {state.cuts.map((c) => (
        <DropdownMenu key={c.scene_id}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              data-track-item
              aria-label={`Transición entre las escenas ${c.position} y ${c.position + 1}: ${transitionLabel(state, c.transition)}`}
              title={`${transitionLabel(state, c.transition)} · clic para cambiarla`}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors",
                c.transition
                  ? "border-brand bg-brand text-primary-foreground"
                  : "border-border bg-panel text-subtle opacity-60 hover:opacity-100",
              )}
              style={{ left: `${pct(c.at_s, duration)}%` }}
            >
              <Blend className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel className="text-[12px]">
              Escena {c.position} → {c.position + 1}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={c.chosen ?? DEFAULT}
              onValueChange={(v) => cut.mutate({ sceneId: c.scene_id, transition: v === DEFAULT ? null : v })}
            >
              <DropdownMenuRadioItem value={DEFAULT}>
                Por defecto ({transitionLabel(state, state.default === "none" ? null : state.default)})
              </DropdownMenuRadioItem>
              {state.options.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </>
  );
}
