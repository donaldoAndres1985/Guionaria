import { Camera, Music2, Play, Plus, Trash2, Tv, Users } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ChannelAvatar } from "@/components/channels/ChannelAvatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useChannels, useDeleteChannel, useSaveChannel } from "@/hooks/useChannels";
import type { Channel, ChannelInput, Platform } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const PLATFORMS: { id: Platform; label: string; hint: string; icon: typeof Play }[] = [
  { id: "youtube", label: "YouTube", hint: "Videos largos y Shorts", icon: Play },
  { id: "tiktok", label: "TikTok", hint: "Reels verticales", icon: Music2 },
  { id: "instagram", label: "Instagram", hint: "Reels verticales", icon: Camera },
  { id: "facebook", label: "Facebook", hint: "Videos y Reels", icon: Users },
];

const LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "en", label: "Inglés" },
  { id: "pt", label: "Portugués" },
];

const EMPTY: ChannelInput = {
  name: "",
  platforms: ["youtube"],
  language: "es",
  niche: null,
  style_prompt: null,
  script_template: "Gancho, contexto, desarrollo, giro, cierre, CTA",
  words_per_second: 2.5,
  default_voice: null,
};

const toInput = (c: Channel): ChannelInput => ({
  name: c.name,
  platforms: c.platforms,
  language: c.language,
  niche: c.niche,
  style_prompt: c.style_prompt,
  script_template: c.script_template,
  words_per_second: c.words_per_second,
  default_voice: c.default_voice,
});

export function ChannelsPage() {
  const { data: channels = [], isPending } = useChannels();
  const [params, setParams] = useSearchParams();
  const creating = params.get("nuevo") === "1";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = creating
    ? null
    : (channels.find((c) => c.id === selectedId) ?? channels[0] ?? null);

  const startNew = () => setParams({ nuevo: "1" });
  const select = (id: number) => {
    setSelectedId(id);
    setParams({});
  };
  const newButton = (
    <Button variant="outline" className="h-10 bg-panel" onClick={startNew}>
      <Plus />
      Nuevo canal
    </Button>
  );

  if (!creating && !selected) {
    return (
      <PageLayout title="Canales y marca" actions={newButton}>
        {!isPending && (
          <EmptyState
            icon={Tv}
            title="Sin canales"
            description="Crea tu primer canal: plataformas, idioma, tono del guion y palabras por segundo de la narración."
            action={
              <Button onClick={startNew}>
                <Plus />
                Crear canal
              </Button>
            }
          />
        )}
      </PageLayout>
    );
  }

  // key: al cambiar de canal se descarta el borrador del anterior.
  return (
    <ChannelEditor
      key={selected?.id ?? "new"}
      channel={selected}
      channels={channels}
      actions={newButton}
      onSelect={select}
    />
  );
}

function ChannelEditor({
  channel,
  channels,
  actions,
  onSelect,
}: {
  channel: Channel | null;
  channels: Channel[];
  actions: React.ReactNode;
  onSelect: (id: number) => void;
}) {
  const initial = channel ? toInput(channel) : EMPTY;
  const [draft, setDraft] = useState<ChannelInput>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveChannel();
  const remove = useDeleteChannel();
  const selectedChannelId = useUiStore((s) => s.selectedChannelId);
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = draft.name.trim().length > 0;
  const set = (patch: Partial<ChannelInput>) => setDraft((d) => ({ ...d, ...patch }));
  const text = (v: string) => (v.trim() ? v : null);
  const totalProjects = channels.reduce((n, c) => n + c.project_count, 0);

  const togglePlatform = (p: Platform, on: boolean) =>
    set({ platforms: on ? [...draft.platforms, p] : draft.platforms.filter((x) => x !== p) });

  const submit = () =>
    save.mutate(
      { id: channel?.id, data: { ...draft, name: draft.name.trim() } },
      {
        onSuccess: (saved) => {
          toast.success(channel ? "Canal guardado" : `Canal "${saved.name}" creado`);
          if (!channel) onSelect(saved.id);
        },
      },
    );

  return (
    <PageLayout
      title="Canales y marca"
      actions={actions}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Canales", value: channels.length },
            { label: "Proyectos", value: totalProjects, highlight: true },
          ]}
        >
          {dirty && channel && (
            <Button variant="ghost" onClick={() => setDraft(initial)}>
              Descartar
            </Button>
          )}
          {channel && (
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-danger"
              disabled={channel.project_count > 0}
              title={
                channel.project_count > 0
                  ? "No se puede eliminar un canal con proyectos"
                  : "Eliminar canal"
              }
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Eliminar
            </Button>
          )}
          <Button
            size="lg"
            className="min-w-36"
            disabled={!dirty || !valid || save.isPending}
            onClick={submit}
          >
            {channel ? "Guardar canal" : "Crear canal"}
          </Button>
        </BottomBar>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r p-2">
          {!channel && (
            <div className="relative flex items-center gap-3 rounded-md bg-panel-2 px-3 py-2.5 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand">
              <span className="flex size-9 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                <Plus className="size-4" />
              </span>
              <span className="truncate text-[13px] font-medium">
                {draft.name.trim() || "Nuevo canal"}
              </span>
            </div>
          )}
          {channels.map((c) => {
            const active = channel?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  active
                    ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                    : "hover:bg-panel-2/60",
                )}
              >
                <ChannelAvatar name={c.name} id={c.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{c.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {c.platforms.map((p) => PLATFORMS.find((x) => x.id === p)?.label).join(" · ") ||
                      "Sin plataformas"}
                  </span>
                </span>
                <span
                  className={cn("text-[12px]", active ? "text-brand" : "text-muted-foreground")}
                  title="Proyectos"
                >
                  {c.project_count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center border-b px-5">
            <span className="text-[13px] font-medium">{channel ? channel.name : "Nuevo canal"}</span>
            {channel && (
              <span className="selectable ml-auto font-mono text-[12px] text-subtle">
                channels/{channel.slug}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid max-w-2xl gap-6 p-5">
              <FormField label="Nombre del canal">
                <Input
                  autoFocus={!channel}
                  value={draft.name}
                  placeholder="Casos Reales"
                  onChange={(e) => set({ name: e.target.value })}
                />
              </FormField>

              <div className="grid gap-1.5">
                <Label className="text-[13px]">Plataformas</Label>
                <div className="divide-y rounded-md border">
                  {PLATFORMS.map((p) => (
                    <label
                      key={p.id}
                      htmlFor={`pf-${p.id}`}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-panel-2/50"
                    >
                      <span className="flex size-8 items-center justify-center rounded-md bg-panel-2">
                        <p.icon className="size-4 text-muted-foreground" strokeWidth={1.6} />
                      </span>
                      <span className="flex-1">
                        <span className="block text-[13px] font-medium">{p.label}</span>
                        <span className="block text-[12px] text-muted-foreground">{p.hint}</span>
                      </span>
                      <Switch
                        id={`pf-${p.id}`}
                        checked={draft.platforms.includes(p.id)}
                        onCheckedChange={(on) => togglePlatform(p.id, on)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField label="Idioma">
                  <Select value={draft.language} onValueChange={(v) => set({ language: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Nicho">
                  <Input
                    value={draft.niche ?? ""}
                    placeholder="Crimen real"
                    onChange={(e) => set({ niche: text(e.target.value) })}
                  />
                </FormField>
                <FormField label="Palabras por segundo" hint="Español narrado: ~2,5">
                  <Input
                    type="number"
                    step={0.1}
                    min={1}
                    max={5}
                    value={draft.words_per_second}
                    onChange={(e) => set({ words_per_second: Number(e.target.value) })}
                  />
                </FormField>
              </div>

              <FormField label="Tono y reglas para Claude" hint="Se añade a cada guion de este canal.">
                <Textarea
                  rows={4}
                  value={draft.style_prompt ?? ""}
                  placeholder="Narración sobria y respetuosa con las víctimas. Frases cortas. Citar fuentes. No mostrar sangre."
                  onChange={(e) => set({ style_prompt: text(e.target.value) })}
                />
              </FormField>

              <FormField label="Estructura del guion" hint="Secciones en orden, separadas por comas.">
                <Textarea
                  rows={2}
                  value={draft.script_template ?? ""}
                  onChange={(e) => set({ script_template: text(e.target.value) })}
                />
              </FormField>
            </div>
          </div>
        </div>
      </div>

      {channel && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`¿Eliminar "${channel.name}"?`}
          description="Se borra el canal y su carpeta vacía. Esta acción no se puede deshacer."
          confirmLabel="Eliminar canal"
          destructive
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(channel.id, {
              onSuccess: () => {
                setConfirmDelete(false);
                if (selectedChannelId === channel.id) setSelectedChannel(null);
                toast.success("Canal eliminado");
              },
            })
          }
        />
      )}
    </PageLayout>
  );
}
