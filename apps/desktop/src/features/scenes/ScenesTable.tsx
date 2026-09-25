import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  Check,
  Copy,
  EllipsisVertical,
  GripVertical,
  Scissors,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MediaKind, Scene, SceneEffect, SceneUpdate } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SceneAction } from "@/hooks/useScenes";
import { EditableCell } from "./EditableCell";
import {
  EFFECT_LABEL,
  EFFECTS,
  formatSceneTime,
  isFirstOfSegment,
  KINDS,
  missingQuery,
  needsReview,
} from "./sceneMeta";

interface ScenesTableProps {
  scenes: Scene[];
  editable: boolean;
  /** Arrastrar para reordenar solo con la vista completa (sin filtro). */
  reorderable: boolean;
  grouped: boolean;
  onUpdate: (id: number, data: SceneUpdate) => void;
  onReorder: (ids: number[]) => void;
  onAction: (id: number, action: SceneAction) => void;
}

type Meta = { width: number; sticky?: number };

const usesStock = (kind: MediaKind) => kind === "video" || kind === "image";

export function ScenesTable({
  scenes,
  editable,
  reorderable,
  grouped,
  onUpdate,
  onReorder,
  onAction,
}: ScenesTableProps) {
  const text = (field: keyof SceneUpdate, label: string, multiline = false, placeholder?: string) =>
    ({
      id: field,
      header: label,
      cell: ({ row }) => (
        <EditableCell
          label={label}
          value={(row.original[field] as string | null) ?? null}
          editable={editable}
          multiline={multiline}
          placeholder={placeholder}
          onCommit={(v) => onUpdate(row.original.id, { [field]: v })}
        />
      ),
    }) satisfies ColumnDef<Scene>;

  const columns = useMemo<ColumnDef<Scene>[]>(
    () => [
      {
        id: "handle",
        header: "",
        meta: { width: 28, sticky: 0 } satisfies Meta,
        cell: () => null, // lo dibuja la fila (necesita el "listener" del arrastre)
      },
      {
        id: "position",
        header: "#",
        meta: { width: 40, sticky: 28 } satisfies Meta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-muted-foreground">{row.original.position}</span>
        ),
      },
      {
        id: "time",
        header: "Inicio–Fin",
        meta: { width: 96, sticky: 68 } satisfies Meta,
        cell: ({ row }) => (
          <span className="block font-mono text-[11px] leading-5 text-muted-foreground">
            {formatSceneTime(row.original.start_s)}
            <br />
            {formatSceneTime(row.original.end_s)}
          </span>
        ),
      },
      {
        id: "narration",
        header: "Narración",
        meta: { width: 240 } satisfies Meta,
        cell: ({ row }) => {
          const scene = row.original;
          if (scene.segment_missing) {
            return <span className="text-[12px] text-danger">Segmento eliminado del guion</span>;
          }
          if (grouped && !isFirstOfSegment(scenes, row.index)) {
            return <span className="pl-2 text-[12px] text-subtle">↳ mismo segmento</span>;
          }
          return (
            <div className="px-1.5 py-1">
              <p className="line-clamp-4 text-[12px] leading-snug text-muted-foreground">
                {scene.narration}
              </p>
              <span className="font-mono text-[10px] text-subtle">{scene.seg_key}</span>
            </div>
          );
        },
      },
      {
        id: "media_kind",
        header: "Tipo",
        meta: { width: 118 } satisfies Meta,
        cell: ({ row }) => (
          <KindSelect
            value={row.original.media_kind}
            editable={editable}
            onChange={(v) => onUpdate(row.original.id, { media_kind: v })}
          />
        ),
      },
      { ...text("visual_description", "Descripción visual", true, "Qué debe verse"), meta: { width: 280 } },
      {
        ...text("query_en", "Búsqueda EN", false, "stock en inglés"),
        meta: { width: 180 },
        cell: ({ row }) => (
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <EditableCell
                label="Búsqueda EN"
                value={row.original.query_en}
                editable={editable}
                placeholder={usesStock(row.original.media_kind) ? "stock en inglés" : "—"}
                onCommit={(v) => onUpdate(row.original.id, { query_en: v })}
              />
            </div>
            {missingQuery(row.original) && (
              <span title={missingQuery(row.original)!} className="pt-1.5 text-warning">
                <TriangleAlert className="size-3.5" />
              </span>
            )}
          </div>
        ),
      },
      { ...text("query_alt", "Búsqueda alternativa"), meta: { width: 170 } },
      {
        ...text("query_real", "Búsqueda real"),
        meta: { width: 190 },
        cell: ({ row }) => (
          <EditableCell
            label="Búsqueda real"
            value={row.original.query_real}
            editable={editable}
            placeholder={row.original.media_kind === "real" ? "material del caso" : "—"}
            onCommit={(v) => onUpdate(row.original.id, { query_real: v })}
          />
        ),
      },
      {
        id: "effect",
        header: "Efecto",
        meta: { width: 170 } satisfies Meta,
        cell: ({ row }) => (
          <EffectSelect
            value={row.original.effect ?? "ninguno"}
            editable={editable}
            onChange={(v) => onUpdate(row.original.id, { effect: v })}
          />
        ),
      },
      { ...text("on_screen_text", "Texto en pantalla"), meta: { width: 160 } },
      { ...text("sfx", "SFX"), meta: { width: 140 } },
      { ...text("music_cue", "Música"), meta: { width: 150 } },
      {
        id: "status",
        header: "Estado",
        meta: { width: 120 } satisfies Meta,
        cell: ({ row }) =>
          needsReview(row.original) ? (
            <span className="flex items-center gap-1">
              <span className="rounded bg-warning/15 px-1.5 py-px text-[11px] text-warning">Revisar</span>
              {editable && row.original.status === "review" && (
                <button
                  type="button"
                  title="Marcar como revisada"
                  onClick={() => onAction(row.original.id, "reviewed")}
                  className="rounded p-0.5 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                >
                  <Check className="size-3.5" />
                </button>
              )}
            </span>
          ) : (
            <span className="rounded bg-panel-2 px-1.5 py-px text-[11px] text-muted-foreground">
              {row.original.status === "pending" ? "Sin medio" : row.original.status}
            </span>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { width: 40 } satisfies Meta,
        cell: ({ row }) =>
          editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Acciones de la escena"
                  className="rounded p-1 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                >
                  <EllipsisVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onAction(row.original.id, "split")}>
                  <Scissors /> Dividir escena
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction(row.original.id, "duplicate")}>
                  <Copy /> Duplicar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onSelect={() => onAction(row.original.id, "delete")}
                >
                  <Trash2 /> Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    // las celdas usan estos valores: se recrean las columnas cuando cambian
    [editable, grouped, scenes, onUpdate, onAction],
  );

  const table = useReactTable({
    data: scenes,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (s) => String(s.id),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = scenes.map((s) => s.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    onReorder(arrayMove(ids, from, to));
  };

  // Franjas alternas por segmento para leer qué escenas van juntas.
  const segmentIndex = useMemo(() => {
    let n = -1;
    return scenes.map((s, i) => (i === 0 || scenes[i - 1].seg_key !== s.seg_key ? ++n : n));
  }, [scenes]);

  const totalWidth = table
    .getAllLeafColumns()
    .reduce((w, c) => w + ((c.columnDef.meta as Meta | undefined)?.width ?? 120), 0);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <table className="border-separate border-spacing-0 text-left" style={{ width: totalWidth }}>
        <thead className="sticky top-0 z-20">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta as Meta | undefined;
                return (
                  <th
                    key={header.id}
                    style={{ width: meta?.width, left: meta?.sticky }}
                    className={cn(
                      "border-b bg-panel px-2 py-2.5 text-[12px] font-normal text-muted-foreground",
                      meta?.sticky !== undefined && "sticky z-30",
                    )}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <SortableContext
          items={scenes.map((s) => String(s.id))}
          strategy={verticalListSortingStrategy}
        >
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <SortableRow
                key={row.id}
                id={row.id}
                reorderable={reorderable}
                review={needsReview(row.original)}
                striped={segmentIndex[row.index] % 2 === 1}
              >
                {(handle) =>
                  row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as Meta | undefined;
                    return (
                      <td
                        key={cell.id}
                        style={{ width: meta?.width, left: meta?.sticky }}
                        className={cn(
                          "border-b px-1 py-1.5 align-top",
                          meta?.sticky !== undefined && "sticky z-10 bg-inherit",
                        )}
                      >
                        {cell.column.id === "handle"
                          ? handle
                          : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })
                }
              </SortableRow>
            ))}
          </tbody>
        </SortableContext>
      </table>
    </DndContext>
  );
}

function SortableRow({
  id,
  reorderable,
  review,
  striped,
  children,
}: {
  id: string;
  reorderable: boolean;
  review: boolean;
  striped: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !reorderable });

  const handle = reorderable ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label="Arrastrar para reordenar"
      className="mt-1 cursor-grab rounded p-0.5 text-subtle hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  ) : null;

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-review={review || undefined}
      className={cn(
        "group bg-panel hover:bg-panel-2/60",
        striped && "bg-[color-mix(in_srgb,var(--bg-panel-2)_45%,var(--bg-panel))]",
        review && "shadow-[inset_3px_0_0_var(--warning)]",
        isDragging && "relative z-40 opacity-80 shadow-lg",
      )}
    >
      {children(handle)}
    </tr>
  );
}

function KindSelect({
  value,
  editable,
  onChange,
}: {
  value: MediaKind;
  editable: boolean;
  onChange: (value: MediaKind) => void;
}) {
  const kind = KINDS.find((k) => k.id === value)!;
  if (!editable) {
    return <span className={cn("ml-1.5 rounded px-1.5 py-0.5 text-[12px]", kind.tone)}>{kind.label}</span>;
  }
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MediaKind)}>
      <SelectTrigger
        aria-label="Tipo de medio"
        className={cn("h-7 w-full border-transparent px-2 text-[12px] shadow-none", kind.tone)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {KINDS.map((k) => (
          <SelectItem key={k.id} value={k.id}>
            {k.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EffectSelect({
  value,
  editable,
  onChange,
}: {
  value: SceneEffect;
  editable: boolean;
  onChange: (value: SceneEffect) => void;
}) {
  if (!editable) {
    return <span className="ml-1.5 text-[12px] text-muted-foreground">{EFFECT_LABEL[value]}</span>;
  }
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SceneEffect)}>
      <SelectTrigger aria-label="Efecto" className="h-7 w-full border-transparent px-2 text-[12px] shadow-none hover:bg-panel-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EFFECTS.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
