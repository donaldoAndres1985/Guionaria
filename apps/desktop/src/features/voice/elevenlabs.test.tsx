import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElevenAccount, Project, VoiceState } from "@/lib/api";
import { estimateCredits } from "./ElevenLabsPanel";
import { useVoiceController } from "./useVoiceController";
import { VoiceBottomBar } from "./VoiceBottomBar";
import { VoiceStage } from "./VoiceStage";

vi.mock("./Waveform", () => ({ Waveform: () => <div data-testid="waveform" /> }));

const project = { id: 7, status: "MEDIOS_APROBADOS", title: "P" } as Project;

const prefs = {
  voice_id: "", voice_name: "", model_id: "eleven_multilingual_v2",
  stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1,
};

// 24 + 27 = 51 caracteres.
const state = (over: Partial<VoiceState> = {}): VoiceState => ({
  project_id: 7, can_edit: true, reason: null, source: null, voice_id: null, speed: null,
  duration_s: null, audio_url: null, timing_source: null, stale: false,
  segments: [
    { seg_key: "seg_001", text: "Esto no es una película.", start_s: null, end_s: null, audio_url: null },
    { seg_key: "seg_002", text: "Le pasó a una familia real.", start_s: null, end_s: null, audio_url: null },
  ],
  word_count: 0, subtitles: [], default_voice: "es_MX-claude-high", whisper_model: "small",
  elevenlabs: prefs, elevenlabs_configured: true, ...over,
});

const MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", hint: "Máxima calidad", credits_per_char: 1 },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", hint: "Mitad de créditos", credits_per_char: 0.5 },
];
const VOICES = [
  { voice_id: "v1", name: "Mateo", category: "cloned", description: null, labels: { accent: "mexicano" }, preview_url: "https://x/m.mp3" },
  { voice_id: "v2", name: "Adam", category: "premade", description: null, labels: { accent: "american" }, preview_url: null },
];

describe("voz con ElevenLabs", () => {
  let server: VoiceState;
  let account: ElevenAccount;
  let requests: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    server = state();
    account = { tier: "free", used: 9000, limit: 10000, remaining: 1000, resets_at: null, can_read: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url.pathname === "/api/voice/elevenlabs/voices") return ok(VOICES);
        if (url.pathname === "/api/voice/elevenlabs/models") return ok(MODELS);
        if (url.pathname === "/api/voice/elevenlabs/account") return ok(account);
        if (url.pathname === "/api/voice/voices") return ok([]);
        if (url.pathname === "/api/jobs") return ok([]);
        if (url.pathname.includes(":reveal")) return new Response(null, { status: 204 });
        if (method === "PUT" && url.pathname.startsWith("/api/voice/elevenlabs/presets/")) {
          const id = decodeURIComponent(url.pathname.split("/").pop()!);
          return ok({ ...server.elevenlabs_presets, [id]: { voice_id: id, ...JSON.parse(String(init!.body)) } });
        }
        if (method === "POST") {
          return ok({ id: 1, type: "voice", project_id: 7, status: "queued", progress: 0, created_at: "" }, 202);
        }
        return ok(server);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderStage() {
    function Harness() {
      const ctl = useVoiceController(project);
      return (
        <>
          <VoiceStage ctl={ctl} onGoToScript={() => {}} />
          <VoiceBottomBar ctl={ctl} />
        </>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const chooseEleven = async () => fireEvent.click(await screen.findByRole("radio", { name: /ElevenLabs/ }));

  it("estima los créditos según el modelo", () => {
    expect(estimateCredits(51, 1)).toBe(51);
    expect(estimateCredits(51, 0.5)).toBe(26);
  });

  it("abre con el motor por defecto de Ajustes", async () => {
    server = state({ default_engine: "elevenlabs" });
    renderStage();
    expect(await screen.findByText("Generar voz con ElevenLabs")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /ElevenLabs/ }) as HTMLInputElement).getAttribute("aria-checked")).toBe("true");
  });

  it("sin clave ofrece ir a Ajustes y no deja generar", async () => {
    server = state({ elevenlabs_configured: false });
    renderStage();
    await chooseEleven();
    expect(screen.getByText(/agrega tu clave en Ajustes/)).toBeTruthy();
    expect((screen.getByText("Generar voz con ElevenLabs").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("elige voz (con buscador) y genera con sus ajustes", async () => {
    renderStage();
    await chooseEleven();
    const list = await screen.findByRole("listbox", { name: "Voces de ElevenLabs" });
    await within(list).findByText("Mateo");
    // Sin voz elegida no se puede generar.
    expect((screen.getByText("Generar voz con ElevenLabs").closest("button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Buscar voz"), { target: { value: "american" } });
    expect(within(list).queryByText("Mateo")).toBeNull();
    fireEvent.click(within(list).getByText("Adam"));
    expect(screen.getByText("Adam", { selector: "span.font-medium.text-foreground" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Estabilidad"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByText("Generar voz con ElevenLabs"));
    await waitFor(() => expect(requests.some((r) => r.path.endsWith(":generate"))).toBe(true));
    expect(requests.find((r) => r.path.endsWith(":generate"))!.body).toEqual({
      voice_id: null,
      speed: 1,
      pause_s: 0.3,
      engine: "elevenlabs",
      elevenlabs: {
        voice_id: "v2", voice_name: "Adam", model_id: "eleven_multilingual_v2", stability: 0.3,
        similarity_boost: 0.75, style: 0, speed: 1,
      },
    });
    // El ajuste movido queda guardado para esa voz.
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true), { timeout: 2000 });
    expect(requests.find((r) => r.method === "PUT")).toMatchObject({
      path: "/api/voice/elevenlabs/presets/v2",
      body: { voice_name: "Adam", stability: 0.3, similarity_boost: 0.75 },
    });
  });

  it("al elegir una voz vuelven sus ajustes guardados", async () => {
    server = state({
      elevenlabs_presets: {
        v1: { ...prefs, voice_id: "v1", voice_name: "Mateo", stability: 0.35, style: 0.2, speed: 0.9, model_id: "eleven_turbo_v2_5" },
      },
    });
    renderStage();
    await chooseEleven();
    const list = await screen.findByRole("listbox", { name: "Voces de ElevenLabs" });
    fireEvent.click(await within(list).findByText("Mateo"));
    expect((screen.getByLabelText("Estabilidad") as HTMLInputElement).value).toBe("0.35");
    expect((screen.getByLabelText("Estilo") as HTMLInputElement).value).toBe("0.2");
    expect((screen.getByLabelText("Velocidad") as HTMLInputElement).value).toBe("0.9");
    // Elegir la voz no guarda nada: solo mover un ajuste.
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
    // Otra voz sin ajustes guardados conserva los actuales.
    fireEvent.click(within(list).getByText("Adam"));
    expect((screen.getByLabelText("Estabilidad") as HTMLInputElement).value).toBe("0.35");
  });

  it("muestra créditos, avisa si no alcanzan y del plan gratuito", async () => {
    account = { ...account, remaining: 40 };
    renderStage();
    await chooseEleven();
    const credits = await screen.findByTestId("eleven-credits");
    await waitFor(() => expect(credits.textContent).toContain("≈ 51 créditos"));
    expect(credits.textContent).toContain("Te quedan 40 este mes");
    expect(credits.textContent).toContain("No alcanzan");
    expect(credits.textContent).toContain("no permite uso comercial");
  });

  it("recuerda la voz de la última generación y abre los subtítulos", async () => {
    server = state({
      source: "elevenlabs",
      voice_id: "v1",
      subtitles: ["voz.srt", "voz.vtt"],
      elevenlabs: { ...prefs, voice_id: "v1", voice_name: "Mateo", model_id: "eleven_turbo_v2_5" },
    });
    renderStage();
    // El motor de la última voz queda elegido.
    expect(await screen.findByRole("radio", { name: /ElevenLabs/, checked: true })).toBeTruthy();
    expect(await screen.findByText("Generar otra vez con ElevenLabs")).toBeTruthy();
    const credits = await screen.findByTestId("eleven-credits");
    await waitFor(() => expect(credits.textContent).toContain("≈ 26 créditos")); // Turbo: mitad
    fireEvent.click(screen.getByText("SRT"));
    await waitFor(() =>
      expect(requests.some((r) => r.path === "/api/projects/7/voice/subtitles/voz.srt:reveal")).toBe(true),
    );
  });
});
