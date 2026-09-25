import { Copy, ExternalLink, FolderOpen, Grid2x2, Images, List, Recycle, Search, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ORIENTATION_LABEL, providerLabel, usageLabel } from "@/features/library/libraryMeta";
import { ReuseDialog } from "@/features/library/ReuseDialog";
import { formatBytes, formatClip, formatResolution } from "@/features/media/mediaMeta";
import { useChannels } from "@/hooks/useChannels";
import { useLibrary, useLibraryStats } from "@/hooks/useLibrary";
import { useOpenUrl, useRevealAsset } from "@/hooks/useManualMedia";
import { useProjects } from "@/hooks/useProjects";
import { coreUrl, type LibraryFilters, type LibraryItem } from "@/lib/api";
import { formatDate } from "@/lib/project";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const ALL = "all";
const PAGE_SIZE = 60;

export function MediaPage() {
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const { data: channels = [] } = useChannels();
  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;
  const { data: projects = [] } = useProjects({ channel: channel?.id });
  const [filters, setFilters] = useState<LibraryFilters>({ sort: "recent" });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "grid">("table");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reusing, setReusing] = useState<LibraryItem | null>(null);
  const query: LibraryFilters = { ...filters, channel: channel?.id, page, page_size: PAGE_SIZE };
  const { data, isPending } = useLibrary(query);
  const { data: stats } = useLibraryStats();
  const items = data?.items ?? [];
  const selected = items.find((i) => i.asset.id === selectedId) ?? null;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const set = (patch: Partial<LibraryFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const kindCount = (k: string) => data?.kinds.find((f) => f.value === k)?.count ?? 0;
  const tabs = [
    { id: null, label: "Todos", count: (data?.kinds ?? []).reduce((n, f) => n + f.count, 0) },
    { id: "image" as const, label: "Imágenes", count: kindCount("image") },
    { id: "video" as const, label: "Videos", count: kindCount("video") },
  ];

  return (
    <PageLayout
      title="Medios"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Medios", value: data?.total ?? "—" },
            { label: "Espacio", value: formatBytes(data?.total_bytes), highlight: true },
            { label: "Ahorrado por duplicados", value: formatBytes(stats?.saved_bytes) },
          ]}
        >
          <Button size="lg" disabled={!selected} onClick={() => selected && setReusing(selected)}>
            <Recycle /> Reutilizar en…
          </Button>
        </BottomBar>
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {tabs.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => set({ kind: t.id })}
            className={cn(
              "rounded px-3 py-1.5 text-[13px]",
              (filters.kind ?? null) === t.id ? "bg-panel-2 font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} <span className="text-subtle">{t.count}</span>
          </button>
        ))}
        <div className="relative ml-auto w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Buscar en la biblioteca"
            placeholder="Nombre, autor u origen"
            className="h-9 pl-8"
            value={filters.q ?? ""}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        <Button size="icon-sm" variant={view === "table" ? "secondary" : "ghost"} aria-label="Vista de tabla" onClick={() => setView("table")}>
          <List />
        </Button>
        <Button size="icon-sm" variant={view === "grid" ? "secondary" : "ghost"} aria-label="Vista de cuadrícula" onClick={() => setView("grid")}>
          <Grid2x2 />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <FilterSelect
          label="Proyecto"
          value={filters.project ? String(filters.project) : ALL}
          onChange={(v) => set({ project: v === ALL ? null : Number(v) })}
          options={projects.map((p) => ({ value: String(p.id), label: p.title }))}
        />
        <FilterSelect
          label="Fuente"
          value={filters.provider ?? ALL}
          onChange={(v) => set({ provider: v === ALL ? null : v })}
          options={(data?.providers ?? []).map((f) => ({ value: f.value, label: `${providerLabel(f.value)} (${f.count})` }))}
        />
        <FilterSelect
          label="Orientación"
          value={filters.orientation ?? ALL}
          onChange={(v) => set({ orientation: v === ALL ? null : v })}
          options={Object.entries(ORIENTATION_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect
          label="Uso"
          value={filters.usage ?? ALL}
          onChange={(v) => set({ usage: v === ALL ? null : (v as LibraryFilters["usage"]) })}
          options={[
            { value: "approved", label: "Aprobados" },
            { value: "unused", label: "Sin usar" },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={!!filters.duplicates} onChange={(e) => set({ duplicates: e.target.checked })} />
          Solo duplicados
        </label>
        <div className="ml-auto">
          <FilterSelect
            label="Orden"
            value={filters.sort ?? "recent"}
            onChange={(v) => set({ sort: v as LibraryFilters["sort"] })}
            options={[
              { value: "recent", label: "Más recientes" },
              { value: "size", label: "Más pesados" },
              { value: "name", label: "Nombre" },
            ]}
            noAll
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!isPending && items.length === 0 ? (
            <EmptyState
              icon={Images}
              title="No hay medios con estos filtros"
              description="Aquí aparece todo lo descargado o agregado en tus proyectos, para reutilizarlo sin volver a descargarlo."
            />
          ) : view === "table" ? (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-panel text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="w-16 px-3 py-2" />
                  <th className="px-2 py-2 font-medium">Archivo</th>
                  <th className="px-2 py-2 font-medium">Proyecto</th>
                  <th className="px-2 py-2 font-medium">Fuente</th>
                  <th className="px-2 py-2 font-medium">Resolución</th>
                  <th className="px-2 py-2 text-right font-medium">Tamaño</th>
                  <th className="px-2 py-2 font-medium">Uso</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.asset.id}
                    onClick={() => setSelectedId(i.asset.id)}
                    className={cn("cursor-pointer border-b hover:bg-panel-2/60", selectedId === i.asset.id && "bg-panel-2")}
                  >
                    <td className="px-3 py-1.5">
                      <Thumb item={i} className="h-9 w-12" />
                    </td>
                    <td className="max-w-64 truncate px-2 font-mono text-[11px]" title={i.asset.file_name}>
                      {i.asset.file_name}
                      {i.duplicates > 0 && (
                        <span className="ml-2 rounded bg-active px-1 font-sans text-[10px] text-active-foreground">
                          ×{i.duplicates + 1}
                        </span>
                      )}
                    </td>
                    <td className="max-w-48 truncate px-2">{i.project_title ?? "—"}</td>
                    <td className="px-2">{providerLabel(i.asset.provider)}</td>
                    <td className="px-2 text-muted-foreground">
                      {formatResolution(i.asset.width, i.asset.height) ?? "—"}
                      {i.asset.duration_s ? ` · ${formatClip(i.asset.duration_s)}` : ""}
                    </td>
                    <td className="px-2 text-right text-muted-foreground">{formatBytes(i.asset.size_bytes)}</td>
                    <td className={cn("px-2", i.used_in.length ? "text-success-foreground" : "text-subtle")}>{usageLabel(i)}</td>
                    <td className="px-3 text-muted-foreground">{formatDate(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-3" data-testid="library-grid">
              {items.map((i) => (
                <button
                  key={i.asset.id}
                  type="button"
                  onClick={() => setSelectedId(i.asset.id)}
                  className={cn(
                    "overflow-hidden rounded-md border bg-panel text-left",
                    selectedId === i.asset.id ? "border-brand" : "hover:border-brand/50",
                  )}
                >
                  <Thumb item={i} className="aspect-video w-full" />
                  <div className="p-2">
                    <div className="truncate text-[12px] font-medium">{i.project_title ?? i.asset.file_name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {providerLabel(i.asset.provider)} · {usageLabel(i)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 p-3 text-[12px]">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              Página {page} de {pages}
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          )}
        </div>
        {selected && <Detail item={selected} onClose={() => setSelectedId(null)} onReuse={() => setReusing(selected)} />}
      </div>
      <ReuseDialog item={reusing} onClose={() => setReusing(null)} />
    </PageLayout>
  );
}

function Thumb({ item, className }: { item: LibraryItem; className?: string }) {
  const src = coreUrl(item.asset.thumb_url ?? (item.asset.kind === "image" ? item.asset.file_url : null));
  return src ? (
    <img src={src} alt="" loading="lazy" className={cn("rounded object-cover", className)} />
  ) : (
    <div className={cn("rounded bg-panel-2", className)} />
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  noAll,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  noAll?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 min-w-36 text-[12px]" aria-label={label}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!noAll && <SelectItem value={ALL}>Todos</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Detail({ item, onClose, onReuse }: { item: LibraryItem; onClose: () => void; onReuse: () => void }) {
  const openUrl = useOpenUrl();
  const reveal = useRevealAsset();
  const a = item.asset;
  const rows: [string, React.ReactNode][] = [
    ["Fuente", providerLabel(a.provider)],
    ["Autor", a.author ?? "—"],
    ["Licencia", a.license ?? "Derechos: revisar"],
    ["Resolución", formatResolution(a.width, a.height) ?? "—"],
    ["Duración", formatClip(a.duration_s) ?? "—"],
    ["Tamaño", formatBytes(a.size_bytes)],
    ["Uso", usageLabel(item)],
    ["Agregado", formatDate(item.created_at)],
  ];
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l" aria-label="Detalle del medio">
      <div className="flex h-11 items-center border-b px-4 text-[13px] font-medium">
        Detalle
        <button type="button" aria-label="Cerrar detalle" className="ml-auto text-muted-foreground" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 p-4">
        {a.kind === "video" ? (
          <video src={coreUrl(a.file_url)} controls className="w-full rounded bg-black" />
        ) : (
          <img src={coreUrl(a.file_url)} alt="" className="w-full rounded bg-black object-contain" />
        )}
        <div className="font-mono text-[11px] break-all text-muted-foreground">{a.file_name}</div>
        {item.project_id && (
          <Link to={`/proyectos/${item.project_id}`} className="text-[13px] font-medium text-brand hover:underline">
            {item.project_title} · {item.channel_name}
          </Link>
        )}
        <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>
        {item.duplicates > 0 && (
          <p className="flex items-center gap-2 rounded-md bg-panel-2 p-2 text-[12px] text-muted-foreground">
            <Copy className="size-3.5" /> Hay {item.duplicates} {item.duplicates === 1 ? "copia" : "copias"} más con el mismo
            contenido; comparten el archivo en disco.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onReuse}>
            <Recycle /> Reutilizar en…
          </Button>
          <Button size="sm" variant="outline" onClick={() => reveal.mutate(a.id)}>
            <FolderOpen /> Mostrar en carpeta
          </Button>
          {a.source_page_url && (
            <Button size="sm" variant="outline" onClick={() => openUrl.mutate(a.source_page_url!)}>
              <ExternalLink /> Origen
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
