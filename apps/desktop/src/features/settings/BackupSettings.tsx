import { CircleAlert, CircleCheck, HardDrive, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatSize } from "@/features/storage/treemap";
import { useBackupStatus } from "@/hooks/useStorage";
import type { AppSettings } from "@/lib/api";

const DEFAULT_BACKUP = { folder: "", before_cleanup: true };

/** Ajustes → Carpetas: carpeta de copia de seguridad del video final y la portada. Sirve una
 * unidad externa o la carpeta sincronizada de Google Drive para escritorio, OneDrive o Dropbox. */
export function BackupSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const backup = settings.backup ?? DEFAULT_BACKUP;
  const set = (patch: Partial<typeof backup>) => onChange({ backup: { ...backup, ...patch } });

  // Se prueba la carpeta escrita (sin guardarla) medio segundo después de dejar de escribir.
  const [checked, setChecked] = useState(backup.folder);
  useEffect(() => {
    const t = setTimeout(() => setChecked(backup.folder), 500);
    return () => clearTimeout(t);
  }, [backup.folder]);
  const status = useBackupStatus(checked);
  const pending = status.isFetching || checked !== backup.folder;
  const suggestions = (status.data?.suggestions ?? []).filter((s) => s.path !== backup.folder);

  return (
    <div className="grid max-w-2xl gap-4 px-5 py-5">
      <div className="flex items-start gap-3">
        <HardDrive className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} />
        <div className="grid gap-1">
          <span className="text-[13px] font-medium">Copia de seguridad</span>
          <p className="text-[12px] text-muted-foreground">
            Antes de borrar el render en Almacenamiento, Guionaria copia el video final y su portada a esta carpeta
            (ordenados por canal y proyecto). Usa la carpeta de Google Drive para escritorio, OneDrive o un disco
            externo.
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="backup-folder" className="text-[13px]">
          Carpeta de respaldo
        </Label>
        <Input
          id="backup-folder"
          value={backup.folder}
          placeholder="G:\Mi unidad\Guionaria"
          spellCheck={false}
          className="font-mono text-[12px]"
          onChange={(e) => set({ folder: e.target.value })}
        />
        {backup.folder.trim() !== "" && (
          <p className="flex items-center gap-1.5 text-[12px]" data-testid="backup-status">
            {pending ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Probando la carpeta…</span>
              </>
            ) : status.data?.ok ? (
              <>
                <CircleCheck className="size-3.5 text-success-foreground" />
                <span className="text-muted-foreground">
                  Lista para guardar copias
                  {status.data.free_bytes != null && ` · ${formatSize(status.data.free_bytes)} libres`}
                </span>
              </>
            ) : (
              <>
                <CircleAlert className="size-3.5 text-warning" />
                <span className="text-warning">{status.data?.detail ?? "No se pudo probar la carpeta"}</span>
              </>
            )}
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-muted-foreground">Encontradas:</span>
            {suggestions.map((s) => (
              <button
                key={s.path}
                type="button"
                className="rounded-md border px-2 py-1 hover:bg-panel-2/60"
                title={s.path}
                onClick={() => set({ folder: s.path })}
              >
                {s.label} <span className="font-mono text-[11px] text-muted-foreground">{s.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor="backup-before-cleanup" className="text-[13px]">
            Copiar antes de borrar el render
          </Label>
          <p className="text-[12px] text-muted-foreground">
            En «Limpieza completa» la opción de copiar a la carpeta de respaldo viene marcada.
          </p>
        </div>
        <Switch
          id="backup-before-cleanup"
          checked={backup.before_cleanup}
          onCheckedChange={(v) => set({ before_cleanup: v })}
        />
      </div>
    </div>
  );
}
