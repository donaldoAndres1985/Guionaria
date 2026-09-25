import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePrompts, useResetPrompt, useSavePrompt } from "@/hooks/usePrompts";
import type { AppSettings, Prompt } from "@/lib/api";

// Radix Select no admite "" como valor: "default" representa "sin --model".
const MODELS = [
  { id: "default", label: "Predeterminado de la CLI", hint: "El modelo que tenga configurado Claude Code" },
  { id: "sonnet", label: "Sonnet", hint: "Rápido y buen equilibrio: gasta menos cuota" },
  { id: "opus", label: "Opus", hint: "El más capaz: gasta más cuota" },
  { id: "haiku", label: "Haiku", hint: "El más rápido y económico" },
];

const PLACEHOLDERS: Record<string, string> = {
  guion:
    "{canal} {estilo} {formato} {relacion} {duracion} {duracion_s} {palabras_objetivo} {estructura} {idioma} {titulo} {tema} {notas} {fecha}",
  reescribir_segmento: "{canal} {estilo} {idioma} {guion} {notas} {fragmento} {instruccion}",
  escenas: "{canal} {estilo} {formato} {relacion} {max_escena_s} {lista_efectos} {guion}",
};

export function ClaudeSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const { data: prompts = [] } = usePrompts();
  const model = settings.claude_model || "default";

  return (
    <div className="grid max-w-3xl gap-8 p-5">
      <FormField
        label="Modelo"
        hint={`${MODELS.find((m) => m.id === model)?.hint ?? ""}. Se guarda con "Guardar ajustes".`}
      >
        <Select
          value={model}
          onValueChange={(v) => onChange({ claude_model: v === "default" ? "" : v })}
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {prompts.map((p) => (
        <PromptEditor key={p.name} prompt={p} />
      ))}
    </div>
  );
}

function PromptEditor({ prompt }: { prompt: Prompt }) {
  const [draft, setDraft] = useState(prompt.content);
  const save = useSavePrompt();
  const reset = useResetPrompt();
  const dirty = draft !== prompt.content;

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">Prompt: {prompt.label}</span>
        <span className="font-mono text-[11px] text-subtle">config/prompts/{prompt.name}.md</span>
        {!prompt.is_default && (
          <span className="rounded bg-active px-1.5 py-px text-[10px] text-active-foreground">
            modificado
          </span>
        )}
      </div>
      <Textarea
        rows={12}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        className="font-mono text-[12px] leading-relaxed"
      />
      <p className="text-[12px] text-muted-foreground">
        Variables disponibles: <span className="font-mono text-subtle">{PLACEHOLDERS[prompt.name]}</span>
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(
              { name: prompt.name, content: draft },
              { onSuccess: () => toast.success("Prompt guardado") },
            )
          }
        >
          Guardar prompt
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(prompt.content)}>
            Descartar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={prompt.is_default || reset.isPending}
          onClick={() =>
            reset.mutate(prompt.name, {
              onSuccess: (p) => {
                setDraft(p.content);
                toast.success("Prompt restaurado al original");
              },
            })
          }
        >
          Restaurar original
        </Button>
      </div>
    </div>
  );
}
