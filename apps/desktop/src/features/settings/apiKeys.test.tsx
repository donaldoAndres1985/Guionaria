import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, KeyTestResult } from "@/lib/api";
import { ApiKeysSettings } from "./ApiKeysSettings";

const baseSettings = (keys: Partial<AppSettings["api_keys"]> = {}): AppSettings => ({
  claude_model: "",
  searxng_url: "http://127.0.0.1:8888",
  whisper_model: "small",
  tts_engine: "piper",
  tts_voice: "",
  download_parallelism: 4,
  ui_language: "es",
  theme: "dark",
  api_keys: { pexels: "", pixabay: "", unsplash: "", freesound: "", ...keys },
});

const health = {
  status: "ok",
  version: "0.1.0",
  home: "C:\\Guionaria",
  db_ok: true,
  dependencies: [
    { name: "yt-dlp", label: "yt-dlp", ok: true, required: false, version: "2026.09.01", path: null, detail: null, install_hint: "" },
  ],
};

describe("claves de API", () => {
  let tests: { path: string; value: string }[];
  let opened: string[];
  let reply: (provider: string, value: string) => Partial<KeyTestResult>;

  beforeEach(() => {
    tests = [];
    opened = [];
    reply = () => ({ status: "valid", message: "Clave verificada", latency_ms: 120, quota_remaining: 199 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/health") return new Response(JSON.stringify(health));
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (path === "/api/system/open-url") {
          opened.push(body.url);
          return new Response(null, { status: 204 });
        }
        const provider = path.match(/keys\/(\w+):test/)![1];
        tests.push({ path, value: body.value });
        return new Response(
          JSON.stringify({ provider, latency_ms: null, quota_remaining: null, ...reply(provider, body.value) }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function Harness({ initial, saved }: { initial: AppSettings; saved: AppSettings }) {
    const [settings, setSettings] = useState(initial);
    return (
      <ApiKeysSettings settings={settings} saved={saved} onChange={(p) => setSettings({ ...settings, ...p })} />
    );
  }

  function renderKeys(initial = baseSettings(), saved = initial) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness initial={initial} saved={saved} />
      </QueryClientProvider>,
    );
  }

  const card = (name: string) => screen.getByRole("article", { name });

  it("muestra el resumen y la cobertura por tipo de medio", async () => {
    renderKeys(baseSettings({ pexels: "pk", freesound: "fk" }));
    expect(screen.getByText("2")).toBeTruthy();
    // Fotos: Pexels + Openverse + Wikimedia; Videos: Pexels + yt-dlp; Sonido: Freesound.
    expect(screen.getByTestId("coverage-photo").textContent).toBe("3 fuentes");
    await waitFor(() => expect(screen.getByTestId("coverage-video").textContent).toBe("2 fuentes"));
    expect(screen.getByTestId("coverage-sound").textContent).toBe("1 fuente");
    expect(within(card("Pixabay")).getByTestId("key-status").textContent).toBe("Sin configurar");
    expect(within(card("Pexels")).getByTestId("key-status").textContent).toBe("Sin probar");
  });

  it("prueba una clave nueva antes de guardarla y marca los cambios", async () => {
    renderKeys();
    const pexels = card("Pexels");
    fireEvent.change(within(pexels).getByLabelText("API Key de Pexels"), { target: { value: "  nueva " } });
    expect(within(pexels).getByText("Sin guardar")).toBeTruthy();
    fireEvent.click(within(pexels).getByText("Probar"));
    await waitFor(() => expect(within(pexels).getByTestId("key-status").textContent).toBe("Verificada"));
    expect(tests).toEqual([{ path: "/api/settings/keys/pexels:test", value: "nueva" }]);
    expect(within(pexels).getByRole("status").textContent).toContain("199 peticiones restantes");

    // Si la clave cambia, el resultado anterior deja de valer.
    fireEvent.change(within(pexels).getByLabelText("API Key de Pexels"), { target: { value: "otra" } });
    expect(within(pexels).getByTestId("key-status").textContent).toBe("Sin probar");
    expect(within(pexels).queryByRole("status")).toBeNull();
  });

  it("indica la clave rechazada", async () => {
    reply = () => ({ status: "invalid", message: "Unsplash rechazó la clave" });
    renderKeys(baseSettings({ unsplash: "mala" }));
    const unsplash = card("Unsplash");
    fireEvent.click(within(unsplash).getByText("Probar"));
    await waitFor(() => expect(within(unsplash).getByTestId("key-status").textContent).toBe("Clave rechazada"));
    expect(within(unsplash).getByRole("status").textContent).toContain("rechazó la clave");
  });

  it("«Probar todas» verifica solo las configuradas y SearXNG", async () => {
    renderKeys(baseSettings({ pexels: "pk", pixabay: "xk" }));
    fireEvent.click(screen.getByText("Probar todas"));
    await waitFor(() => expect(tests).toHaveLength(3));
    expect(tests.map((t) => t.path).sort()).toEqual([
      "/api/settings/keys/pexels:test",
      "/api/settings/keys/pixabay:test",
      "/api/settings/keys/searxng:test",
    ]);
  });

  it("borra, muestra y oculta la clave", () => {
    renderKeys(baseSettings({ pixabay: "secreta" }));
    const pixabay = card("Pixabay");
    const input = within(pixabay).getByLabelText("API Key de Pixabay") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(within(pixabay).getByLabelText("Mostrar clave"));
    expect(input.type).toBe("text");
    fireEvent.click(within(pixabay).getByLabelText("Borrar clave"));
    expect(input.value).toBe("");
    expect(within(pixabay).getByLabelText("Pegar clave")).toBeTruthy();
  });

  it("pega la clave del portapapeles", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn(async () => " pegada\n") },
      configurable: true,
    });
    renderKeys();
    const freesound = card("Freesound");
    fireEvent.click(within(freesound).getByLabelText("Pegar clave"));
    await waitFor(() =>
      expect((within(freesound).getByLabelText("API Key de Freesound") as HTMLInputElement).value).toBe("pegada"),
    );
  });

  it("abre la página para obtener la clave y muestra los pasos", async () => {
    renderKeys();
    const unsplash = card("Unsplash");
    fireEvent.click(within(unsplash).getByText("¿Cómo la obtengo?"));
    expect(within(unsplash).getByText(/Access Key» \(el Secret Key no se usa\)/)).toBeTruthy();
    fireEvent.click(within(unsplash).getByText("Obtener clave"));
    await waitFor(() => expect(opened).toEqual(["https://unsplash.com/oauth/applications/new"]));
  });

  it("prueba la URL de SearXNG", async () => {
    reply = () => ({ status: "error", message: "Responde, pero falta activar el formato json en settings.yml" });
    renderKeys();
    const input = screen.getByLabelText("URL de SearXNG");
    fireEvent.change(input, { target: { value: "http://127.0.0.1:9999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/falta activar el formato json/)).toBeTruthy();
    expect(tests).toEqual([{ path: "/api/settings/keys/searxng:test", value: "http://127.0.0.1:9999" }]);
  });
});
