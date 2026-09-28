import { createContext, useContext, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface Preview {
  url: string;
  title: string;
}

const PreviewContext = createContext<(p: Preview) => void>(() => {});

/** Doble clic en una miniatura: se abre grande (Esc o clic fuera para cerrar). */
export function ImagePreviewProvider({ children }: { children: React.ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  return (
    <PreviewContext.Provider value={setPreview}>
      {children}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="flex max-h-[92vh] w-auto max-w-[min(1400px,94vw)] flex-col items-center gap-3 bg-panel p-4 sm:max-w-[min(1400px,94vw)]">
          <DialogTitle className="text-[13px] font-medium">{preview?.title}</DialogTitle>
          <DialogDescription className="sr-only">Vista grande de la miniatura</DialogDescription>
          {preview && (
            <img
              src={preview.url}
              alt={preview.title}
              data-testid="image-preview"
              className="max-h-[calc(92vh-5rem)] max-w-full rounded object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </PreviewContext.Provider>
  );
}

export const useImagePreview = () => useContext(PreviewContext);
