import { Check, CircleCheck, CircleAlert, Copy, LoaderCircle, Plug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMcpInfo, useRegisterClaudeCode } from "@/hooks/useMcp";

const EXAMPLES = [
  "Crea un reel para el canal Casos Reales sobre el caso X, escribe el guion y guárdalo.",
  "Arma las escenas del proyecto 12 y busca medios para las que faltan.",
  "Genera la voz del proyecto 12 y exporta el timeline.",
];

/** Conexión con Claude Code y Claude Desktop por MCP (sección 4.2). */
export function McpSettings() {
  const { data: info, isError } = useMcpInfo();
  const register = useRegisterClaudeCode();

  if (isError) {
    return <p className="p-5 text-[13px] text-muted-foreground">Sin conexión con el núcleo.</p>;
  }
  if (!info) return null;

  return (
    <div className="grid max-w-2xl gap-6 p-5 text-[13px]">
      <p className="text-muted-foreground">
        Con MCP le pides a Claude, desde Claude Code o Claude Desktop, que cree proyectos, escriba el guion y las
        escenas, busque medios, genere la voz y exporte el timeline. Claude redacta con tu plan y guarda el
        resultado en Guionaria: la app no vuelve a llamarlo.
      </p>

      <section className="grid gap-2">
        <h3 className="font-medium">Claude Code</h3>
        <div className="flex items-center gap-3 rounded-md border p-3">
          {info.claude_code_registered ? (
            <CircleCheck className="size-5 shrink-0 text-success-foreground" />
          ) : (
            <CircleAlert className="size-5 shrink-0 text-warning" />
          )}
          <span className="flex-1">
            {!info.claude_code_available
              ? "No se encontró Claude Code CLI en este equipo."
              : info.claude_code_registered
                ? "Guionaria está registrado en Claude Code para todos tus proyectos."
                : "Guionaria todavía no está registrado en Claude Code."}
          </span>
          {info.claude_code_available && !info.claude_code_registered && (
            <Button
              size="sm"
              disabled={register.isPending}
              onClick={() =>
                register.mutate(undefined, { onSuccess: () => toast.success("Guionaria quedó registrado en Claude Code") })
              }
            >
              {register.isPending ? <LoaderCircle className="animate-spin" /> : <Plug />}
              Registrar en Claude Code
            </Button>
          )}
        </div>
        <CopyBlock label="O en una terminal" value={info.claude_code_command} />
        <p className="text-[12px] text-muted-foreground">
          Funciona mientras la app está abierta (el servidor vive en {info.http_url}).
        </p>
      </section>

      <section className="grid gap-2">
        <h3 className="font-medium">Claude Desktop</h3>
        <p className="text-muted-foreground">
          Agrega este bloque a <code className="font-mono text-[12px]">claude_desktop_config.json</code> (Claude
          Desktop → Configuración → Desarrollador → Editar configuración) y reinicia Claude Desktop. No necesita la app
          abierta.
        </p>
        <CopyBlock value={info.desktop_config} multiline />
      </section>

      <section className="grid gap-2">
        <h3 className="font-medium">Ejemplos de pedidos</h3>
        <ul className="grid gap-1.5 text-muted-foreground">
          {EXAMPLES.map((e) => (
            <li key={e}>«{e}»</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CopyBlock({ label, value, multiline }: { label?: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div className="grid gap-1">
      {label && <span className="text-[12px] text-muted-foreground">{label}</span>}
      <div className="flex items-start gap-2 rounded-md border bg-panel p-2.5">
        <code className={`selectable min-w-0 flex-1 font-mono text-[12px] ${multiline ? "whitespace-pre" : "truncate"}`}>
          {value}
        </code>
        <Button size="icon-xs" variant="ghost" aria-label="Copiar" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
