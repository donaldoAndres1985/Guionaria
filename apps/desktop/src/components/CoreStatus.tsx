import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useHealth } from "@/hooks/useCore";
import { CORE_URL } from "@/lib/api";

/** Aviso cuando el núcleo local no responde (se reintenta solo cada 2 s). */
export function CoreStatus() {
  const { isError, isPending } = useHealth();

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Conectando con el núcleo local…
      </div>
    );
  }
  if (!isError) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px]">
      <TriangleAlert className="size-4 shrink-0 text-warning" />
      <span>
        No se puede conectar con el núcleo local{" "}
        <code className="selectable font-mono text-[12px] text-muted-foreground">{CORE_URL}</code>.
        Reintentando…
      </span>
    </div>
  );
}
