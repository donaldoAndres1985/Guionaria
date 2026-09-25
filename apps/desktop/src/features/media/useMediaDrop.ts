import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImportSource } from "@/hooks/useManualMedia";
import { candidateAt, extractUrl, isEditableTarget, isMediaFile, urlFromText } from "./dropUtils";

type Importer = (source: ImportSource, candidateId?: number) => Promise<unknown>;

/**
 * Arrastrar y soltar / pegar (sección 5.7):
 * - En la app, Tauri entrega las rutas de los archivos soltados desde el explorador.
 * - En el navegador (desarrollo), los archivos llegan por HTML5 y se suben.
 * - Ctrl+V pega una imagen del portapapeles o una dirección.
 * Soltar sobre un candidato que falló le asigna el archivo (conserva su autor y licencia).
 */
export function useMediaDrop(enabled: boolean, importer: Importer) {
  const [dragging, setDragging] = useState(false);
  const importerRef = useRef(importer);
  importerRef.current = importer;

  // Arrastre nativo de Tauri (rutas de archivo).
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          const ratio = window.devicePixelRatio || 1;
          const target = candidateAt(p.position.x / ratio, p.position.y / ratio);
          const paths = p.paths.filter(isMediaFile);
          if (!paths.length) {
            toast.error("Suelta imágenes o videos. Para una imagen de la web, copia su dirección y pégala con Ctrl+V.");
            return;
          }
          void (async () => {
            for (const [i, path] of paths.entries()) {
              await importerRef.current({ kind: "path", path }, i === 0 ? target : undefined).catch(() => {});
            }
          })();
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  // Ctrl+V: imagen del portapapeles o dirección.
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || !e.clipboardData) return;
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (files.length) {
        e.preventDefault();
        void (async () => {
          for (const file of files) await importerRef.current({ kind: "file", file }).catch(() => {});
        })();
        return;
      }
      const url = urlFromText(e.clipboardData.getData("text/plain"));
      if (url) {
        e.preventDefault();
        void importerRef.current({ kind: "url", url }).catch(() => {});
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);

  // HTML5 (navegador de desarrollo; en Tauri los archivos llegan por el evento nativo).
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      setDragging(false);
      const target = candidateAt(e.clientX, e.clientY);
      const files = [...e.dataTransfer.files].filter((f) => isMediaFile(f.name));
      if (files.length) {
        void (async () => {
          for (const [i, file] of files.entries()) {
            await importerRef.current({ kind: "file", file }, i === 0 ? target : undefined).catch(() => {});
          }
        })();
        return;
      }
      const url = extractUrl(e.dataTransfer);
      if (url) void importerRef.current({ kind: "url", url }, target).catch(() => {});
    },
  };

  return { dragging, dropProps };
}
