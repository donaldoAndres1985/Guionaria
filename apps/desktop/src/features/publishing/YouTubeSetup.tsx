import { ExternalLink, LoaderCircle, Plug, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSaveSettings, useSettings } from "@/hooks/useCore";
import { useOpenUrl } from "@/hooks/useManualMedia";
import { useYouTube } from "@/hooks/usePublishing";
import type { PublishingState } from "@/lib/api";

const STEPS: { text: string; url?: string }[] = [
  { text: "Entra a Google Cloud y crea un proyecto (gratis).", url: "https://console.cloud.google.com/projectcreate" },
  { text: "Activa «YouTube Data API v3» en ese proyecto.", url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com" },
  {
    text:
      "Pantalla de consentimiento (Google Auth Platform): tipo «Externo» y luego «Publicar app» (En producción); en modo prueba el acceso caduca cada 7 días.",
    url: "https://console.cloud.google.com/auth/overview",
  },
  { text: "Credenciales → Crear → ID de cliente de OAuth → tipo «App de escritorio».", url: "https://console.cloud.google.com/apis/credentials" },
  { text: "Copia el ID y el secreto de cliente y pégalos aquí abajo." },
  { text: "Al conectar, Google avisará «app no verificada»: es tu propia app → «Avanzado» → «Ir a…» y acepta." },
];

/**
 * Configura y conecta YouTube: el cliente OAuth de Google (una vez, en Ajustes) y el acceso de
 * este canal (inicio de sesión de Google en el navegador).
 */
export function YouTubeSetup({ state, onWaiting }: { state: PublishingState; onWaiting: (waiting: boolean) => void }) {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const openUrl = useOpenUrl();
  const youtube = useYouTube(state.channel_id);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (waiting && state.youtube.connected) {
      setWaiting(false);
      toast.success(`YouTube conectado: ${state.youtube.account}`);
    }
  }, [waiting, state.youtube.connected, state.youtube.account]);
  useEffect(() => onWaiting(waiting), [waiting, onWaiting]);

  if (state.youtube.connected) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-3 text-[12px]" data-testid="youtube-connected">
        <Plug className="size-4 text-success-foreground" />
        <span className="min-w-0 flex-1">
          Canal de YouTube conectado: <span className="font-medium">{state.youtube.account}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => youtube.disconnect.mutate()}>
          <Unplug /> Desconectar
        </Button>
      </div>
    );
  }

  if (!state.youtube.configured) {
    return (
      <div className="grid gap-3 rounded-md border p-3 text-[12px]" aria-label="Configurar YouTube">
        <div>
          <h4 className="text-[13px] font-medium">Subir directo a YouTube</h4>
          <p className="text-muted-foreground">
            Una sola vez: crea tu acceso gratuito de Google (unos 10 minutos). Mientras tu proyecto de Google no pase la auditoría,
            YouTube deja los videos en privado y los haces públicos con un clic en YouTube Studio.
          </p>
        </div>
        <ol className="grid gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.text} className="flex items-start gap-2">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[10px]">{i + 1}</span>
              <span className="min-w-0 flex-1">{s.text}</span>
              {s.url && (
                <button type="button" className="text-brand hover:underline" onClick={() => openUrl.mutate(s.url!)}>
                  Abrir <ExternalLink className="inline size-3" />
                </button>
              )}
            </li>
          ))}
        </ol>
        <p className="text-subtle">
          Si Google pide una URI de redirección, usa <span className="font-mono">{state.youtube.redirect_uri}</span>
        </p>
        <div className="grid gap-2">
          <Input aria-label="ID de cliente de Google" placeholder="ID de cliente (…apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <Input aria-label="Secreto de cliente de Google" type="password" placeholder="Secreto de cliente" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <Button
            size="sm"
            className="justify-self-start"
            disabled={!settings || !clientId.trim() || !secret.trim() || save.isPending}
            onClick={() =>
              settings &&
              save.mutate(
                { ...settings, youtube: { client_id: clientId.trim(), client_secret: secret.trim() } },
                { onSuccess: () => toast.success("Acceso de Google guardado: ahora conecta el canal") },
              )
            }
          >
            Guardar acceso de Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border p-3 text-[12px]">
      <p className="text-muted-foreground">
        Conecta el canal de YouTube de «{state.channel_name}»: se abre Google en tu navegador, eliges la cuenta y aceptas los permisos.
      </p>
      <Button
        size="sm"
        className="justify-self-start"
        disabled={youtube.connect.isPending || waiting}
        onClick={() => youtube.connect.mutate(undefined, { onSuccess: () => setWaiting(true) })}
      >
        {waiting ? <LoaderCircle className="animate-spin" /> : <Plug />}
        {waiting ? "Esperando a Google…" : "Conectar canal de YouTube"}
      </Button>
      {waiting && <p className="text-subtle">Termina el inicio de sesión en el navegador; esta pantalla se actualiza sola.</p>}
    </div>
  );
}
