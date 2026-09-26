import {
  AudioLines,
  ChevronRight,
  Clapperboard,
  Database,
  Film,
  Folder,
  HardDrive,
  Home,
  Images,
  LayoutGrid,
  List,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { CleanupDialog } from "@/features/storage/CleanupDialog";
import { formatSize, pathTo, percent, squarify } from "@/features/storage/treemap";
import { useCleanupPreview, useStorageUsage } from "@/hooks/useStorage";
import type { StorageNode } from "@/lib/api";
import { cn } from "@/lib/utils";

// Tonos apagados como la referencia 05 (fondo oscuro, texto claro).
const TILE_COLORS = ["#5a3418", "#1f3a3a", "#3d3417", "#33293d", "#402a1d", "#243823", "#3a2226", "#23303f"];

function iconFor(node: StorageNode): LucideIcon {
  if (node.kind === "channel") return Clapperboard;
  if (node.kind === "project") return Folder;
  if (node.id.endsWith(":approved") || node.id.endsWith(":candidates") || node.id.endsWith(":manual")) return Images;
  if (node.id.endsWith(":audio")) return AudioLines;
  if (node.id.endsWith(":timeline") || node.id.endsWith(":render")) return Film;
  if (node.id === "models") return Sparkles;
  if (node.id === "trash") return Trash2;
  if (node.id === "data") return Database;
  return Folder;
}

export function StoragePage() {
  const { data: usage, refetch, isFetching } = useStorageUsage();
  const { data: preview } = useCleanupPreview();
  const [currentId, setCurrentId] = useState("root");
  const [view, setView] = useState<"treemap" | "list">("treemap");
  const [cleaning, setCleaning] = useState(false);

  const trail = usage ? pathTo(usage.tree, currentId) : [];
  const current = trail.at(-1) ?? usage?.tree;
  const children = current?.children ?? [];

  return (
    <PageLayout
      title="Almacenamiento"
      actions={
        <Button variant="outline" className="h-10 bg-panel" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className={cn(isFetching && "animate-spin")} /> Analizar de nuevo
        </Button>
      }
      bottomBar={
        <BottomBar
          stats={[
            { label: "Guionaria ocupa", value: formatSize(usage?.tree.bytes ?? 0), highlight: true },
            { label: "Libre en el disco", value: usage ? formatSize(usage.disk_free) : "—" },
            { label: "Ahorrado con enlaces", value: formatSize(usage?.shared_bytes ?? 0) },
          ]}
        >
          <Button size="lg" disabled={!preview?.total_count} onClick={() => setCleaning(true)}>
            <Trash2 /> Liberar {formatSize(preview?.total_bytes ?? 0)} de candidatos sin usar
          </Button>
        </BottomBar>
      }
    >
      {!usage || !current ? (
        <EmptyState icon={HardDrive} title="Analizando el espacio…" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
            <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3 text-[13px]">
              <Button size="icon-sm" variant="ghost" aria-label="Inicio" onClick={() => setCurrentId("root")}>
                <Home />
              </Button>
              {trail.map((n, i) => (
                <span key={n.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5 text-subtle" />}
                  <button
                    type="button"
                    onClick={() => setCurrentId(n.id)}
                    className={cn("rounded px-1.5 py-0.5", i === trail.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground")}
                  >
                    {n.name}
                  </button>
                </span>
              ))}
              <div className="ml-auto flex rounded-md border p-0.5">
                <Button size="xs" variant={view === "treemap" ? "secondary" : "ghost"} onClick={() => setView("treemap")}>
                  <LayoutGrid /> Treemap
                </Button>
                <Button size="xs" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>
                  <List /> Lista
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className={cn("min-h-0 overflow-y-auto", view === "treemap" ? "w-[44%] border-r" : "flex-1")}>
                <div className="px-4 py-2 text-[12px] text-muted-foreground">
                  {children.length} elementos · {current.files.toLocaleString("es")} archivos · {formatSize(current.bytes)}
                </div>
                {children.map((n) => (
                  <Row key={n.id} node={n} total={current.bytes} onOpen={() => n.children.length && setCurrentId(n.id)} />
                ))}
                {children.length === 0 && <p className="p-4 text-[13px] text-muted-foreground">Está vacío.</p>}
              </div>
              {view === "treemap" && (
                <Treemap nodes={children} total={current.bytes} onOpen={(n) => n.children.length && setCurrentId(n.id)} />
              )}
            </div>
          </div>
        </div>
      )}
      <CleanupDialog open={cleaning} preview={preview} onClose={() => setCleaning(false)} />
    </PageLayout>
  );
}

function Row({ node, total, onOpen }: { node: StorageNode; total: number; onOpen: () => void }) {
  const Icon = iconFor(node);
  const pct = percent(node.bytes, total);
  const drill = node.children.length > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!drill}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-panel-2/60"
    >
      <Icon className="size-8 shrink-0 rounded-md bg-panel-2 p-1.5 text-brand" strokeWidth={1.6} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{node.name}</span>
        <span className="block text-[12px] text-muted-foreground">{node.files.toLocaleString("es")} archivos</span>
      </span>
      <span className="w-40 shrink-0">
        <span className="flex justify-between text-[12px]">
          <span className="font-medium">{formatSize(node.bytes)}</span>
          <span className="text-muted-foreground">{pct}%</span>
        </span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-panel-2">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(pct, node.bytes ? 1 : 0)}%` }} />
        </span>
      </span>
      <ChevronRight className={cn("size-4 shrink-0", drill ? "text-muted-foreground" : "invisible")} />
    </button>
  );
}

function Treemap({ nodes, total, onOpen }: { nodes: StorageNode[]; total: number; onOpen: (n: StorageNode) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const tiles = squarify(nodes, (n) => n.bytes, { x: 0, y: 0, w: size.w, h: size.h });

  return (
    <div ref={box} className="relative min-w-0 flex-1 m-2" data-testid="treemap">
      {tiles.map((t, i) => {
        const small = t.w < 90 || t.h < 60;
        return (
          <button
            key={t.item.id}
            type="button"
            title={`${t.item.name} · ${formatSize(t.item.bytes)}`}
            onClick={() => onOpen(t.item)}
            className="absolute overflow-hidden rounded-md border border-black/30 p-3 text-left transition-[filter] hover:brightness-125"
            style={{ left: t.x + 2, top: t.y + 2, width: t.w - 4, height: t.h - 4, background: TILE_COLORS[i % TILE_COLORS.length] }}
          >
            {!small && (
              <>
                <span className="block truncate text-[14px] font-medium text-white/90">{t.item.name}</span>
                <span className="block text-[12px] text-white/70">{formatSize(t.item.bytes)}</span>
              </>
            )}
            {t.h > 40 && t.w > 36 && (
              <span className="absolute right-2.5 bottom-2 text-[12px] text-brand">{percent(t.item.bytes, total)}%</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
