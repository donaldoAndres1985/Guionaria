import { Check, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { STAGE_PANEL_WIDTH, type StagePanelMode, useUiStore } from "@/stores/ui";

const MODES: { id: StagePanelMode; label: string; hint: string }[] = [
  { id: "expanded", label: "Completa", hint: "Siempre con nombres y estado" },
  { id: "compact", label: "Solo iconos", hint: "Siempre contraída" },
  { id: "auto", label: "Automática", hint: "Iconos en Escenas y Medios" },
];

/** ¿La barra se muestra contraída en esta vista? */
export function useStagePanelCompact(wideView: boolean) {
  const mode = useUiStore((s) => s.stagePanelMode);
  return mode === "compact" || (mode === "auto" && wideView);
}

/**
 * Columna de etapas del proyecto: ancho ajustable arrastrando el borde (doble clic lo restablece)
 * y un menú para elegir si se muestra completa, solo con iconos o de forma automática.
 */
export function StagePanel({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  const width = useUiStore((s) => s.stagePanelWidth);
  const setWidth = useUiStore((s) => s.setStagePanelWidth);
  const mode = useUiStore((s) => s.stagePanelMode);
  const setMode = useUiStore((s) => s.setStagePanelMode);
  const panelRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const left = panelRef.current?.getBoundingClientRect().left ?? 0;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => setWidth(ev.clientX - left);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setWidth(width - 16);
    else if (e.key === "ArrowRight") setWidth(width + 16);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={panelRef}
      data-testid="stage-panel"
      style={compact ? undefined : { width }}
      className={cn("relative flex shrink-0 flex-col border-r", compact && "w-14")}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>

      <div className={cn("flex shrink-0 items-center border-t p-2", compact ? "justify-center" : "justify-between")}>
        {!compact && (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            onClick={() => setMode("compact")}
          >
            <PanelLeftClose className="size-3.5" /> Contraer
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Vista de la barra de etapas"
              title="Vista de la barra de etapas"
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            >
              {compact ? <PanelLeftOpen className="size-4" /> : <SlidersHorizontal className="size-3.5" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="text-[12px] text-muted-foreground">Barra de etapas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {MODES.map((m) => (
              <DropdownMenuItem key={m.id} onSelect={() => setMode(m.id)} className="items-start">
                <Check className={cn("mt-0.5 size-4", mode === m.id ? "text-brand" : "invisible")} />
                <span>
                  <span className="block text-[13px]">{m.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!compact && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho de la barra de etapas"
          aria-valuenow={width}
          aria-valuemin={STAGE_PANEL_WIDTH.min}
          aria-valuemax={STAGE_PANEL_WIDTH.max}
          tabIndex={0}
          title="Arrastra para ajustar el ancho · doble clic para restablecer"
          onPointerDown={startResize}
          onDoubleClick={() => setWidth(STAGE_PANEL_WIDTH.default)}
          onKeyDown={onResizeKey}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-brand focus-visible:outline-none focus-visible:after:bg-brand"
        />
      )}
    </div>
  );
}
