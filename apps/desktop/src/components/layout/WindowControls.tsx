import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Botones de ventana propios (la ventana va sin decoraciones nativas, como la referencia 01).
 * Fuera de Tauri (Vite en el navegador) no se muestran.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const inTauri = isTauri();

  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized);
    sync();
    const unlisten = win.onResized(sync);
    return () => void unlisten.then((fn) => fn());
  }, [inTauri]);

  if (!inTauri) return null;
  const win = getCurrentWindow();

  return (
    <div className="flex h-full items-start self-start">
      <CaptionButton label="Minimizar" onClick={() => void win.minimize()}>
        <Minus className="size-4" strokeWidth={1.5} />
      </CaptionButton>
      <CaptionButton
        label={maximized ? "Restaurar" : "Maximizar"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.5} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.5} />
        )}
      </CaptionButton>
      <CaptionButton label="Cerrar" danger onClick={() => void win.close()}>
        <X className="size-4" strokeWidth={1.5} />
      </CaptionButton>
    </div>
  );
}

function CaptionButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-10 w-12 items-center justify-center text-muted-foreground transition-colors",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-panel-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
