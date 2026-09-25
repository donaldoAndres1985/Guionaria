import { Check, ChevronDown, Layers, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { ChannelAvatar } from "@/components/channels/ChannelAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChannels } from "@/hooks/useChannels";
import { useProjects } from "@/hooks/useProjects";
import { isCompleted, isThisMonth } from "@/lib/project";
import { useUiStore } from "@/stores/ui";

/**
 * Selector de canal del encabezado (como el selector de disco de la referencia 01).
 * La barra muestra el % de proyectos con publicación objetivo este mes que ya están terminados.
 */
export function ChannelSelector() {
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const selectedId = useUiStore((s) => s.selectedChannelId);
  const setSelected = useUiStore((s) => s.setSelectedChannel);
  const selected = channels.find((c) => c.id === selectedId) ?? null;
  const { data: projects = [] } = useProjects({ channel: selected?.id });

  const thisMonth = projects.filter((p) => isThisMonth(p.target_publish_at));
  const done = thisMonth.filter(isCompleted).length;
  const pct = thisMonth.length ? (done / thisMonth.length) * 100 : 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-72 flex-col justify-center gap-1.5 rounded-md border bg-panel px-3 outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex w-full items-center gap-2 text-[13px]">
            <Layers className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.6} />
            <span className="truncate font-medium">
              {selected?.name ?? (channels.length ? "Todos los canales" : "Sin canales")}
            </span>
            <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
              {done}/{thisMonth.length} este mes
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
          <span className="h-[3px] w-full overflow-hidden rounded-full bg-panel-2">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => setSelected(null)}>
          <Layers className="size-4" />
          Todos los canales
          {!selected && <Check className="ml-auto size-4" />}
        </DropdownMenuItem>
        {channels.length > 0 && <DropdownMenuSeparator />}
        {channels.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => setSelected(c.id)}>
            <ChannelAvatar name={c.name} id={c.id} className="size-5 rounded text-[10px]" />
            <span className="truncate">{c.name}</span>
            {selected?.id === c.id && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/canales?nuevo=1")}>
          <Plus className="size-4" />
          Nuevo canal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
