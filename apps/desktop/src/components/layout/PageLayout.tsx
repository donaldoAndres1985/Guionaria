import { isTauri } from "@tauri-apps/api/core";
import { CoreStatus } from "@/components/CoreStatus";
import { cn } from "@/lib/utils";
import { WindowControls } from "./WindowControls";

interface PageLayoutProps {
  title: string;
  /** Controles a la derecha del título: selector de canal, botón secundario... */
  actions?: React.ReactNode;
  /** Barra inferior fija con resumen y acción principal (referencias 01/03). */
  bottomBar?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Estructura de cada pantalla. El encabezado hace también de barra de título:
 * se puede arrastrar la ventana y doble clic la maximiza.
 */
export function PageLayout({ title, actions, bottomBar, children }: PageLayoutProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header
        data-tauri-drag-region
        // Sin botones de ventana (Vite en el navegador) el margen derecho lo pone el header.
        className={cn("flex h-14 shrink-0 items-center gap-3 pl-6", !isTauri() && "pr-6")}
      >
        <h1
          data-tauri-drag-region
          className="truncate text-[22px] font-normal tracking-tight"
        >
          {title}
        </h1>
        <div data-tauri-drag-region className="h-full flex-1" />
        {actions && <div className="flex items-center gap-2">{actions}</div>}
        <WindowControls />
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4">
        <CoreStatus />
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-panel">
          {children}
        </section>
        {bottomBar}
      </main>
    </div>
  );
}
