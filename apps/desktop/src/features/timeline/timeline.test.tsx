import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, RenderState, TimelineState } from "@/lib/api";
import { TimelineBottomBar } from "./TimelineBottomBar";
import { TimelineStage } from "./TimelineStage";
import { clipCount, pct, resolutionLabel, rulerStep, rulerTicks } from "./timelineMeta";

const project = { id: 7, status: "VOZ_LISTA", title: "P" } as Project;

const timeline = (over: Partial<TimelineState> = {}): TimelineState => ({
  project_id: 7,
  can_export: true,
  reason: null,
  fps: 30,
  width: 1080,
  height: 1920,
  duration_s: 4.9,
  has_voice: true,
  voice_duration_s: 4.9,
  scenes: [
    { position: 1, kind: "video", start_s: 0, duration_s: 1.3, clip_duration_s: 1.3, file_name: "001_0000_video_a.mp4", thumb_url: "/api/assets/1/thumb", text: null },
    { position: 2, kind: "image", start_s: 1.3, duration_s: 1.3, clip_duration_s: 1.3, file_name: "002_0001_imagen_b.jpg", thumb_url: null, text: null },
    { position: 3, kind: "text", start_s: 2.6, duration_s: 2.3, clip_duration_s: null, file_name: null, thumb_url: null, text: "SIN RESPUESTA" },
  ],
  markers: [
    { time_s: 0, name: "Escena 1 · video", note: "Efecto: zoom_lento_in", color: "ORANGE" },
    { time_s: 2.6, name: "Escena 3 · texto", note: "Texto: «SIN RESPUESTA»", color: "BLUE" },
  ],
  warnings: [],
  folder: "C:\\Guionaria\\timeline",
  exports: [],
  ...over,
});

describe("utilidades del timeline", () => {
  it("regla con pasos legibles", () => {
    expect(rulerStep(4.9)).toBe(1);
    expect(rulerStep(45)).toBe(5);
    expect(rulerStep(600)).toBe(60);
    expect(rulerTicks(4.9)).toEqual([0, 1, 2, 3, 4]);
    expect(pct(2.45, 4.9)).toBe(50);
    expect(pct(1, 0)).toBe(0);
  });

  it("resolución y clips", () => {
    expect(resolutionLabel(timeline())).toBe("9:16 · 1080×1920 · 30 fps");
    expect(resolutionLabel(timeline({ width: 1920, height: 1080 }))).toBe("16:9 · 1920×1080 · 30 fps");
    expect(clipCount(timeline())).toBe(2);
  });
});

describe("etapa de timeline", () => {
  let server: TimelineState;
  let renderState: RenderState;
  const renderJob = { id: 9, type: "render", project_id: 7, status: "running", progress: 0.42, message: "Escena 2 de 3…", created_at: "" };
  let posts: { path: string; body: unknown }[];

  beforeEach(() => {
    posts = [];
    renderState = {
      project_id: 7,
      can_render: true,
      reason: null,
      has_voice: true,
      has_subtitles: true,
      default_burn_subtitles: true,
      duration_s: 4.9,
      scenes: 3,
      files: [
        { kind: "final", name: "proyecto.mp4", url: "/api/projects/7/render/files/proyecto.mp4", size_bytes: 8 * 1024 * 1024, duration_s: 4.9, width: 1080, height: 1920, updated_at: "2026-09-26T10:00:00" },
        { kind: "thumbnail", name: "miniatura.jpg", url: "/api/projects/7/render/files/miniatura.jpg", size_bytes: 90000, duration_s: null, width: 1080, height: 1920, updated_at: "2026-09-26T10:00:00" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "POST") {
          posts.push({ path, body: JSON.parse(String(init.body)) });
          if (path.endsWith("/render")) return new Response(JSON.stringify(renderJob), { status: 202 });
          if (path.endsWith(":export")) {
            server = {
              ...server,
              exports: [
                { format: "otio", file: "proyecto.otio", updated_at: "2026-09-25T15:40:00" },
                { format: "fcpxml", file: "proyecto.fcpxml", updated_at: "2026-09-25T15:40:00" },
                { format: "edl", file: "proyecto.edl", updated_at: "2026-09-25T15:40:00" },
              ],
            };
            const files = ["proyecto.otio", "proyecto.fcpxml", "proyecto.edl"];
            return new Response(JSON.stringify({ folder: "x", files, warnings: [], state: server }));
          }
          return new Response(null, { status: 204 });
        }
        if (path === "/api/jobs") return new Response(JSON.stringify([]));
        if (path.startsWith("/api/jobs/")) return new Response(JSON.stringify(renderJob));
        if (path.endsWith("/render")) return new Response(JSON.stringify(renderState));
        return new Response(JSON.stringify(server));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderStage(onGoToMedia = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TimelineStage project={project} onGoToMedia={onGoToMedia} />
        <TimelineBottomBar project={project} />
      </QueryClientProvider>,
    );
    return onGoToMedia;
  }

  it("muestra pistas, marcadores y estadísticas", async () => {
    server = timeline();
    renderStage();
    expect(await screen.findByText("9:16 · 1080×1920 · 30 fps")).toBeTruthy();
    const blocks = screen.getByTestId("track-video").children;
    expect(blocks).toHaveLength(3);
    expect((blocks[2] as HTMLElement).style.left).toMatch(/^53\.06/);
    expect(screen.getByText("«SIN RESPUESTA»")).toBeTruthy();
    expect(screen.getByText("Texto: «SIN RESPUESTA»")).toBeTruthy();
    expect(screen.getByText("voz · 0:05")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getAllByText("Sin exportar")).toHaveLength(3);
  });

  it("exporta los tres formatos", async () => {
    server = timeline();
    renderStage();
    await screen.findByText("2/3"); // estado cargado: el botón ya está habilitado
    fireEvent.click(screen.getByText("Exportar timeline"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/api/projects/7/timeline:export", body: { formats: null } });
    expect(await screen.findByText("Exportar otra vez")).toBeTruthy();
    expect(screen.getByText(/timeline\/proyecto\.fcpxml · 25\/9 15:40/)).toBeTruthy();
  });

  it("bloquea la exportación hasta aprobar los medios", async () => {
    server = timeline({ can_export: false, reason: "Aprueba los medios antes de exportar el timeline" });
    const go = renderStage();
    expect(await screen.findByText("Aprueba los medios antes de exportar el timeline")).toBeTruthy();
    expect((screen.getByText("Exportar timeline").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Ir a medios"));
    expect(go).toHaveBeenCalled();
  });

  it("avisos y proyecto sin voz", async () => {
    server = timeline({
      has_voice: false,
      voice_duration_s: null,
      warnings: ["El proyecto no tiene voz: el timeline usa los tiempos estimados."],
    });
    renderStage();
    expect(await screen.findByText(/no tiene voz: el timeline usa/)).toBeTruthy();
    expect(screen.getByText("Sin voz: se usan los tiempos estimados")).toBeTruthy();
    expect(screen.getByText("Sin voz")).toBeTruthy();
  });

  it("render: opciones, progreso y resultado", async () => {
    server = timeline();
    renderStage();
    const panel = await screen.findByLabelText("Render");
    expect(within(panel).getByText(/render\/proyecto\.mp4 · 8.00 MB/)).toBeTruthy();
    expect(within(panel).getByAltText("Miniatura sugerida")).toBeTruthy();
    const burn = within(panel).getByLabelText("Quemar subtítulos") as HTMLInputElement;
    expect(burn.checked).toBe(true); // reel: por defecto sí
    fireEvent.click(burn);
    fireEvent.click(within(panel).getByText("Borrador 720p"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    expect(posts.find((p) => p.path.endsWith("/render"))!.body).toEqual({ draft: true, burn_subtitles: false });
    expect(await within(panel).findByText("Escena 2 de 3…")).toBeTruthy();
  });

  it("render bloqueado hasta aprobar los medios", async () => {
    server = timeline();
    renderState = { ...renderState, can_render: false, reason: "Aprueba los medios antes de renderizar", files: [] };
    renderStage();
    const panel = await screen.findByLabelText("Render");
    expect(within(panel).getByText("Aprueba los medios antes de renderizar")).toBeTruthy();
    expect((within(panel).getByText("Render final").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
