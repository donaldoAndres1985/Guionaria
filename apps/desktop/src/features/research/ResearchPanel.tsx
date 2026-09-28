import { BookOpenCheck, CircleCheck, CircleDot, ExternalLink, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { type ResearchTarget, useResearch } from "@/hooks/useResearch";
import type { Certeza, Research } from "@/lib/api";
import { cn } from "@/lib/utils";

const CERTEZA: Record<Certeza, { label: string; icon: typeof CircleCheck; tone: string }> = {
  confirmado: { label: "Confirmado", icon: CircleCheck, tone: "text-success-foreground" },
  una_fuente: { label: "Una sola fuente", icon: CircleDot, tone: "text-warning" },
  en_disputa: { label: "En disputa", icon: TriangleAlert, tone: "text-danger" },
};

const TIPO: Record<string, string> = {
  oficial: "Oficial",
  judicial: "Judicial",
  prensa: "Prensa",
  academica: "Académica",
  libro: "Libro",
  otra: "Otra",
};

/**
 * «Investigar con fuentes»: botón que lanza la búsqueda web de Claude y la ficha resultante
 * (datos con su certeza y citas, fuentes con enlace, contradicciones e incógnitas).
 */
export function ResearchPanel({
  target,
  research,
  disabled,
}: {
  target: ResearchTarget;
  research: Research | null | undefined;
  disabled?: boolean;
}) {
  const job = useResearch(target);
  const openUrl = useOpenUrl();
  const [highlight, setHighlight] = useState<number | null>(null);
  const d = research?.dossier;

  return (
    <section className="grid gap-4 rounded-md border p-4" aria-label="Investigación con fuentes">
      <div className="flex flex-wrap items-center gap-3">
        <BookOpenCheck className="size-4 text-brand" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium">Investigación con fuentes</h3>
          <p className="text-[12px] text-muted-foreground">
            {research
              ? `Hecha el ${new Date(research.created_at).toLocaleDateString("es")} · las notas se actualizaron con las citas`
              : "Claude busca en internet, verifica cada dato y cita sus fuentes antes de escribir el guion."}
          </p>
        </div>
        <Button variant={research ? "outline" : "default"} disabled={disabled || job.running} onClick={job.start}>
          {job.running ? <LoaderCircle className="animate-spin" /> : <Search />}
          {job.running ? "Investigando…" : research ? "Investigar de nuevo" : "Investigar con fuentes"}
        </Button>
      </div>
      {job.running && (
        <p className="text-[12px] text-muted-foreground">
          {job.message ?? "Buscando fuentes"} · puede tardar unos minutos y gasta cuota de tu plan de Claude.
        </p>
      )}
      {job.error && <p className="text-[12px] text-danger">{job.error}</p>}

      {d && research && (
        <>
          <div className="flex flex-wrap gap-2 text-[12px]" data-testid="research-stats">
            {(Object.keys(CERTEZA) as Certeza[]).map((c) => {
              const C = CERTEZA[c];
              return (
                <span key={c} className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5", C.tone)}>
                  <C.icon className="size-3.5" /> {research.stats[c]} {C.label.toLowerCase()}
                </span>
              );
            })}
            <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{research.stats.fuentes} fuentes</span>
          </div>

          <p className="text-[13px] leading-relaxed">{d.resumen}</p>

          <ul className="grid gap-2">
            {d.datos.map((fact) => {
              const C = CERTEZA[fact.certeza];
              return (
                <li key={fact.afirmacion} className="flex gap-2 text-[13px]">
                  <C.icon className={cn("mt-0.5 size-4 shrink-0", C.tone)} aria-label={C.label} />
                  <span className="min-w-0">
                    {fact.afirmacion}{" "}
                    {fact.fuentes.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onMouseEnter={() => setHighlight(id)}
                        onMouseLeave={() => setHighlight(null)}
                        onClick={() => {
                          const src = d.fuentes.find((f) => f.id === id);
                          if (src) openUrl.mutate(src.url);
                        }}
                        className="mx-0.5 rounded bg-panel-2 px-1 font-mono text-[11px] text-brand hover:bg-active"
                        title="Abrir la fuente"
                      >
                        [{id}]
                      </button>
                    ))}
                    {fact.nota && <span className="block text-[12px] text-muted-foreground">{fact.nota}</span>}
                  </span>
                </li>
              );
            })}
          </ul>

          {(
            [
              ["Contradicciones entre fuentes", d.contradicciones, "text-danger"],
              ["Sin verificar o sin resolver", d.incognitas, "text-warning"],
              ["Cuidados al contarlo", d.cuidados, "text-muted-foreground"],
              ["Ganchos posibles", d.ganchos, "text-brand"],
            ] as const
          )
            .filter(([, items]) => items.length)
            .map(([title, items, tone]) => (
              <div key={title}>
                <h4 className={cn("text-[12px] font-medium", tone)}>{title}</h4>
                <ul className="mt-1 grid gap-1 text-[12px] text-muted-foreground">
                  {items.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
            ))}

          <div>
            <h4 className="text-[12px] font-medium">Fuentes</h4>
            <ol className="mt-1 grid gap-1">
              {d.fuentes.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    "flex items-start gap-2 rounded px-1.5 py-1 text-[12px] transition-colors",
                    highlight === f.id && "bg-active",
                  )}
                >
                  <span className="font-mono text-[11px] text-brand">[{f.id}]</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{f.titulo}</span>
                    <span className="text-muted-foreground">
                      {[f.medio, f.fecha].filter(Boolean).length ? ` — ${[f.medio, f.fecha].filter(Boolean).join(", ")}` : ""}
                    </span>
                    <span className="ml-1.5 rounded bg-panel-2 px-1 text-[10px] text-subtle">{TIPO[f.tipo] ?? f.tipo}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Abrir ${f.titulo}`}
                    onClick={() => openUrl.mutate(f.url)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
