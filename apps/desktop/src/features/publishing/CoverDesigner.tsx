import { Check, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { coreUrl, type CoverDesign, type PublishingState } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PublishController } from "./PublishStage";

const TEMPLATES: { id: CoverDesign["plantilla"]; label: string }[] = [
  { id: "impacto", label: "Impacto" },
  { id: "documental", label: "Documental" },
  { id: "expediente", label: "Expediente" },
];
const ACCENTS = ["#FFD400", "#E53935", "#FFFFFF", "#33D6FF"];

/**
 * Miniatura diseñada con Claude: mira los cuadros del video y propone 3 diseños (cuadro, texto,
 * palabra resaltada, plantilla y foco); aquí se eligen, se retocan y se vuelven a dibujar.
 */
export function CoverDesigner({ state, ctl }: { state: PublishingState; ctl: PublishController }) {
  const options = state.cover_options ?? [];
  const [selected, setSelected] = useState(1);
  const option = options.find((o) => o.index === selected) ?? options[0];
  const [design, setDesign] = useState<CoverDesign | null>(option?.design ?? null);
  useEffect(() => setDesign(option?.design ?? null), [option?.url, option?.design]);
  const job = ctl.coverJob;
  const portrait = state.format === "reel";

  return (
    <div className="grid gap-2" aria-label="Miniatura con Claude">
      <Button size="sm" disabled={job.running} onClick={() => void job.start()} title="Claude mira los cuadros del video (gasta cuota de tu plan)">
        {job.running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
        {job.running ? "Claude está diseñando…" : options.length ? "Diseñar otras con Claude" : "Diseñar miniatura con Claude"}
      </Button>
      {job.running && <p className="text-[11px] text-muted-foreground">{job.job?.message ?? "Preparando…"}</p>}
      {job.error && <p className="text-[11px] text-danger">{job.error}</p>}

      {options.length > 0 && (
        <>
          <div role="radiogroup" aria-label="Propuestas de miniatura" className={cn("grid gap-1.5", portrait ? "grid-cols-3" : "grid-cols-1")}>
            {options.map((o) => (
              <button
                key={o.index}
                type="button"
                role="radio"
                aria-checked={o.index === option?.index}
                aria-label={`Propuesta ${o.index}: ${o.design.texto}`}
                onClick={() => setSelected(o.index)}
                className={cn("overflow-hidden rounded border-2", o.index === option?.index ? "border-brand" : "border-transparent hover:border-border")}
              >
                <img src={coreUrl(o.url) ?? ""} alt={o.design.texto} className="w-full" />
              </button>
            ))}
          </div>
          {option && design && (
            <div className="grid gap-2 rounded-md border p-2 text-[12px]" aria-label="Retocar propuesta">
              {option.design.por_que && <p className="text-[11px] text-subtle">{option.design.por_que}</p>}
              <Input aria-label="Texto de la miniatura" value={design.texto} onChange={(e) => setDesign({ ...design, texto: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Palabra resaltada" placeholder="Resaltar" value={design.resaltar ?? ""} onChange={(e) => setDesign({ ...design, resaltar: e.target.value || null })} />
                <Input aria-label="Rótulo" placeholder="Rótulo" value={design.etiqueta ?? ""} onChange={(e) => setDesign({ ...design, etiqueta: e.target.value || null })} />
              </div>
              <div className="flex items-center gap-2">
                <Select value={design.plantilla} onValueChange={(v) => setDesign({ ...design, plantilla: v as CoverDesign["plantilla"] })}>
                  <SelectTrigger className="h-8 flex-1" aria-label="Plantilla">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Acento ${c}`}
                    aria-pressed={design.color.toUpperCase() === c}
                    onClick={() => setDesign({ ...design, color: c })}
                    className={cn("size-5 shrink-0 rounded-full border", design.color.toUpperCase() === c && "ring-2 ring-brand ring-offset-1 ring-offset-background")}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ctl.actions.redrawCover.isPending || JSON.stringify(design) === JSON.stringify(option.design)}
                  onClick={() => ctl.actions.redrawCover.mutate({ index: option.index, design })}
                >
                  {ctl.actions.redrawCover.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Volver a dibujar
                </Button>
                <Button
                  size="sm"
                  disabled={ctl.actions.chooseCover.isPending}
                  onClick={() => ctl.actions.chooseCover.mutate(option.index, { onSuccess: () => toast.success("Miniatura elegida") })}
                >
                  <Check /> Usar esta
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
