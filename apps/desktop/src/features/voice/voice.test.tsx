import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, VoiceState } from "@/lib/api";
import { useVoiceController } from "./useVoiceController";
import { primaryAction, segmentAt, sourceLabel, speedLabel, timingLabel } from "./voiceMeta";
import { VoiceBottomBar } from "./VoiceBottomBar";
import { VoiceStage } from "./VoiceStage";

// wavesurfer.js necesita audio y canvas reales: en jsdom se reemplaza por un marcador.
const waveform = vi.hoisted(() => ({ props: null as null | { url: string; segments: unknown[] } }));
vi.mock("./Waveform", () => ({
  Waveform: (props: { url: string; segments: unknown[] }) => {
    waveform.props = props;
    return <div data-testid="waveform" />;
  },
}));

const project = { id: 7, status: "MEDIOS_APROBADOS", title: "P" } as Project;

const voiceState = (over: Partial<VoiceState> = {}): VoiceState => ({
  project_id: 7,
  can_edit: true,
  reason: null,
  source: null,
  voice_id: null,
  speed: null,
  duration_s: null,
  audio_url: null,
  timing_source: null,
  stale: false,
  segments: [
    { seg_key: "seg_001", text: "Esto no es una película.", start_s: null, end_s: null, audio_url: null },
    { seg_key: "seg_002", text: "Le pasó a una familia real.", start_s: null, end_s: null, audio_url: null },
  ],
  word_count: 0,
  subtitles: [],
  default_voice: "es_MX-claude-high",
  whisper_model: "small",
  ...over,
});

const piperState = () =>
  voiceState({
    source: "piper",
    voice_id: "es_MX-ald-medium",
    speed: 1.1,
    duration_s: 4.3,
    audio_url: "/api/projects/7/voice/audio",
    timing_source: "voice",
    subtitles: ["voz.srt", "voz.vtt"],
    segments: [
      { seg_key: "seg_001", text: "Esto no es una película.", start_s: 0, end_s: 1.5, audio_url: "/a" },
      { seg_key: "seg_002", text: "Le pasó a una familia real.", start_s: 1.8, end_s: 4.3, audio_url: "/b" },
    ],
  });

describe("utilidades de voz", () => {
  it("etiquetas de velocidad y fuente", () => {
    expect(speedLabel(1)).toBe("Normal");
    expect(speedLabel(1.2)).toBe("1.2×");
    expect(sourceLabel("piper")).toBe("Voz generada con Piper");
    expect(sourceLabel(null)).toBe("Sin voz");
  });

  it("de dónde salen los tiempos", () => {
    expect(timingLabel(undefined)).toBe("Estimados");
    expect(timingLabel(piperState())).toBe("Reales · voz generada");
    expect(timingLabel({ ...piperState(), timing_source: "whisper" })).toBe("Reales · Whisper");
    expect(timingLabel({ ...piperState(), stale: true })).toBe("Estimados (voz desactualizada)");
    expect(timingLabel(voiceState({ source: "recorded" }))).toBe("Estimados (falta transcribir)");
  });

  it("segmento que suena en cada instante", () => {
    const { segments } = piperState();
    expect(segmentAt(segments, 0.5)).toBe("seg_001");
    expect(segmentAt(segments, 1.6)).toBeNull(); // pausa entre segmentos
    expect(segmentAt(segments, 2)).toBe("seg_002");
    expect(segmentAt(voiceState().segments, 1)).toBeNull();
  });

  it("acción principal", () => {
    expect(primaryAction(voiceState({ can_edit: false }))).toBe("none");
    expect(primaryAction(voiceState())).toBe("generate");
    expect(primaryAction(voiceState({ source: "recorded" }))).toBe("transcribe");
    expect(primaryAction({ ...piperState(), source: "recorded", timing_source: "whisper" })).toBe("generate");
    expect(primaryAction({ ...piperState(), source: "recorded", timing_source: "whisper", stale: true })).toBe(
      "transcribe",
    );
  });
});

describe("etapa de voz", () => {
  let server: VoiceState;
  let requests: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    waveform.props = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body =
          init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method, path: url.pathname, body });
        const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url.pathname === "/api/voice/voices") return ok([]);
        if (url.pathname === "/api/jobs") return ok([]);
        if (url.pathname.startsWith("/api/jobs/")) {
          return ok({ id: 1, type: "voice", project_id: 7, status: "running", progress: 0.2, message: "Generando…" });
        }
        if (url.pathname.endsWith(":upload")) {
          server = voiceState({ source: "recorded", duration_s: 6, audio_url: "/api/projects/7/voice/audio" });
          return ok(server);
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

  function renderStage(onGoToScript = vi.fn()) {
    function Harness() {
      const ctl = useVoiceController(project);
      return (
        <>
          <VoiceStage ctl={ctl} onGoToScript={onGoToScript} />
          <VoiceBottomBar ctl={ctl} />
        </>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    return onGoToScript;
  }

  it("pide aprobar el guion primero", async () => {
    server = voiceState({ can_edit: false, reason: "Aprueba el guion antes de grabar o generar la voz" });
    const go = renderStage();
    expect(await screen.findByText("Aprueba el guion antes de grabar o generar la voz")).toBeTruthy();
    fireEvent.click(screen.getByText("Ir al guion"));
    expect(go).toHaveBeenCalled();
    expect((screen.getByText("Generar voz con Piper").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("sin voz: genera con la voz por defecto, velocidad normal y pausa corta", async () => {
    server = voiceState();
    renderStage();
    expect(await screen.findByText("Todavía no hay voz")).toBeTruthy();
    expect(screen.getByText("Estimados")).toBeTruthy();
    fireEvent.click(screen.getByText("Generar voz con Piper"));
    await waitFor(() => expect(requests.some((r) => r.path === "/api/projects/7/voice:generate")).toBe(true));
    const post = requests.find((r) => r.path === "/api/projects/7/voice:generate")!;
    expect(post.body).toEqual({ voice_id: "es_MX-claude-high", speed: 1, pause_s: 0.3 });
    expect(await screen.findByText("Generando…")).toBeTruthy(); // progreso del trabajo
  });

  it("voz generada: forma de onda, tiempos reales y regenerar un segmento", async () => {
    server = piperState();
    renderStage();
    expect(await screen.findByTestId("waveform")).toBeTruthy();
    expect(waveform.props?.url).toMatch(/^http:\/\/127\.0\.0\.1:8765\/api\/projects\/7\/voice\/audio\?v=\d+/);
    expect(screen.getByText("0:01.8 – 0:04.3")).toBeTruthy();
    expect(screen.getByText("Reales · voz generada")).toBeTruthy();
    expect(screen.getByText("SRT · VTT")).toBeTruthy();
    expect(screen.getByText("Generar la voz otra vez")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Regenerar el segmento 2"));
    await waitFor(() =>
      expect(requests.some((r) => r.path === "/api/projects/7/voice/segments/seg_002:regenerate")).toBe(true),
    );
  });

  it("vuelve a generar con la voz y velocidad de la última vez", async () => {
    server = piperState();
    renderStage();
    fireEvent.click(await screen.findByText("Generar la voz otra vez"));
    await waitFor(() => expect(requests.some((r) => r.path.endsWith(":generate"))).toBe(true));
    expect(requests.find((r) => r.path.endsWith(":generate"))!.body).toEqual({
      voice_id: "es_MX-ald-medium",
      speed: 1.1,
      pause_s: 0.3,
    });
  });

  it("voz grabada: se sube y se transcribe con Whisper", async () => {
    server = voiceState();
    renderStage();
    await screen.findByText("Todavía no hay voz");
    const file = new File(["RIFF"], "mi voz.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByTestId("voice-file"), { target: { files: [file] } });
    await waitFor(() => expect(requests.some((r) => r.path.endsWith(":upload"))).toBe(true));
    const upload = requests.find((r) => r.path.endsWith(":upload"))!;
    expect((upload.body as FormData).get("file")).toBeInstanceOf(File);

    expect(await screen.findByText(/Transcribe la voz con Whisper \(modelo «small»\)/)).toBeTruthy();
    expect(screen.getByText("Voz grabada")).toBeTruthy();
    fireEvent.click(screen.getByText("Transcribir con Whisper"));
    await waitFor(() => expect(requests.some((r) => r.path.endsWith(":transcribe"))).toBe(true));
  });

  it("avisa cuando el guion cambió después de la voz", async () => {
    server = { ...piperState(), stale: true, timing_source: null };
    renderStage();
    expect(await screen.findByText(/El guion cambió después de la voz/)).toBeTruthy();
    expect(screen.getByText("Estimados (voz desactualizada)")).toBeTruthy();
  });
});
