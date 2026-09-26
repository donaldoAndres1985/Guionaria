import { Copy, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { providerLabel } from "@/features/library/libraryMeta";
import { useExportRights, useRights } from "@/hooks/useHistory";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { cn } from "@/lib/utils";

/** Registro de derechos del proyecto (sección 5.15): origen, autor y licencia de cada medio. */
export function RightsPanel({ projectId }: { projectId: number }) {
  const { data } = useRights(projectId);
  const exporter = useExportRights(projectId);
  const openUrl = useOpenUrl();
  if (!data) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.credits);
      toast.success("Créditos copiados: pégalos en la descripción del video");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <section className="grid gap-3" aria-label="Derechos y créditos">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-medium">Derechos y créditos</h3>
        {data.review_count > 0 && (
          <span className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">
            <ShieldAlert className="size-3" /> {data.review_count} por revisar
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="xs" variant="outline" disabled={!data.rows.length} onClick={() => void copy()}>
            <Copy /> Copiar créditos
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!data.rows.length || exporter.isPending}
            onClick={() => exporter.mutate(undefined, { onSuccess: () => toast.success("Se guardó derechos.csv en la carpeta del proyecto") })}
          >
            <FileSpreadsheet /> Exportar CSV
          </Button>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <p className="rounded-md border p-3 text-[12px] text-muted-foreground">Todavía no hay medios aprobados.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-[12px]">
            <thead className="bg-panel text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Escena</th>
                <th className="px-2 py-1.5 font-medium">Origen</th>
                <th className="px-2 py-1.5 font-medium">Autor</th>
                <th className="px-2 py-1.5 font-medium">Licencia</th>
                <th className="px-3 py-1.5 font-medium">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.scene_position}-${r.file_name}`} className={cn("border-t", r.needs_review && "bg-warning/5")}>
                  <td className="px-3 py-1.5">
                    {r.scene_position} <span className="text-subtle">· {r.scene_start}{r.role === "alterno" ? " · alterno" : ""}</span>
                  </td>
                  <td className="px-2">{r.origin === "Tercero" || r.origin === "Propio" ? `${r.origin} · ${providerLabel(r.provider)}` : r.origin}</td>
                  <td className="max-w-40 truncate px-2">{r.author ?? "—"}</td>
                  <td className={cn("max-w-48 truncate px-2", r.needs_review && "text-warning")}>{r.license ?? "Derechos: revisar"}</td>
                  <td className="px-3">
                    {r.source_url ? (
                      <button type="button" className="text-brand hover:underline" onClick={() => openUrl.mutate(r.source_url!)}>
                        Abrir
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
