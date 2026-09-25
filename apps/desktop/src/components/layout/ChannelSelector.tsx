import { ChevronDown, Tv } from "lucide-react";

/**
 * Selector de canal del encabezado (como el selector de disco de la referencia 01).
 * La barra indica el % de proyectos del mes completados. Los canales llegan en la Fase 1.
 */
export function ChannelSelector() {
  return (
    <button
      type="button"
      disabled
      title="Los canales se crean en la Fase 1"
      className="flex h-10 w-64 flex-col justify-center gap-1.5 rounded-md border bg-panel px-3 disabled:cursor-not-allowed"
    >
      <span className="flex w-full items-center gap-2 text-[13px]">
        <Tv className="size-4 text-muted-foreground" strokeWidth={1.6} />
        <span className="font-medium">Sin canales</span>
        <span className="ml-auto text-[12px] text-muted-foreground">0/0 este mes</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </span>
      <span className="h-[3px] w-full overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full w-0 rounded-full bg-brand" />
      </span>
    </button>
  );
}
