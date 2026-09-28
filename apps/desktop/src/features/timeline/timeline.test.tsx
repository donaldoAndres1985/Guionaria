import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewState, Project, RenderState, TimelineState, TransitionsState } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { TimelineBottomBar } from "./TimelineBottomBar";
import { TimelineStage } from "./TimelineStage";
import { PreviewCanvas } from "./PreviewPlayer";
import { clipCount, pct, resolutionLabel, rulerStep, rulerTicks } from "./timelineMeta";

const project = { id: 7, status: "VOZ_LISTA", title: "P", format: "reel" } as Project;

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
    { position: 1, kind: "video", start_s: 0, duration_s: 1.3, clip_duration_s: 1.3, file_name: "001_0000_video_a.mp4", thumb_url: "/api/assets/1/thumb", text: null, scene_id: 11, asset_id: 1, is_video: true },
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

const previewState = (t: TimelineState): PreviewState => ({
  project_id: 7,
  width: t.width,
  height: t.height,
  fps: 30,
  duration_s: t.duration_s,
  scenes: [
    { position: 1, scene_id: 11, kind: "video", start_s: 0, duration_s: 1.3, effect: "zoom_lento_in", text: null,
      media: { kind: "video", url: "/api/scenes/11/assets/1/approved-file", source_in_s: 2, duration_s: 1.3 } },
    { position: 2, scene_id: 12, kind: "image", start_s: 1.3, duration_s: 1.3, effect: null, text: null,
      media: { kind: "image", url: "/api/scenes/12/assets/2/approved-file", source_in_s: 0, duration_s: 1.3 } },
    { position: 3, scene_id: 13, kind: "text", start_s: 2.6, duration_s: 2.3, effect: null, text: "SIN RESPUESTA", media: null },
  ],
  voice_url: t.has_voice ? "/api/projects/7/voice/audio" : null,
  sfx: [],
  music: [],
  words: t.has_voice
    ? [
        { text: "Esto", start: 0, end: 0.3 },
        { text: "no", start: 0.3, end: 0.5 },
        { text: "es", start: 0.5, end: 0.7 },
        { text: "real.", start: 0.7, end: 1.2 },
      ]
    : [],
  subtitle_style: {
    uppercase: true, words_per_line: 0, font: "Arial", size: "medium", position: "bottom",
    text_color: "#FFFFFF", outline_color: "#000000", highlight: true, highlight_color: "#FFD400", background: false,
  },
  default_burn_subtitles: true,
  zoom: 0.15,
  music_volume: 0.35,
  sfx_volume: 0.9,
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

const transitionsState = (over: Partial<TransitionsState> = {}): TransitionsState => ({
  default: "none",
  duration: 0.5,
  options: [
    { id: "none", label: "Corte directo" },
    { id: "fade", label: "Fundido cruzado" },
    { id: "circleopen", label: "Círculo que se abre" },
  ],
  cuts: [
    { scene_id: 11, position: 1, from_kind: "video", to_kind: "image", at_s: 1.3, chosen: null, transition: null, duration_s: 0 },
    { scene_id: 12, position: 2, from_kind: "image", to_kind: "text", at_s: 2.6, chosen: null, transition: null, duration_s: 0 },
  ],
  ...over,
});

describe("etapa de timeline", () => {
  let server: TimelineState;
  let transitions: TransitionsState;
  let puts: { path: string; body: unknown }[];
  let renderState: RenderState;
  const renderJob = { id: 9, type: "render", project_id: 7, status: "running", progress: 0.42, message: "Escena 2 de 3…", created_at: "" };
  let posts: { path: string; body: unknown }[];

  beforeEach(() => {
    posts = [];
    puts = [];
    transitions = transitionsState();
    useUiStore.setState({ renderQuality: "standard" });
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    HTMLMediaElement.prototype.pause = vi.fn();
    renderState = {
      project_id: 7,
      can_render: true,
      reason: null,
      has_voice: true,
      has_subtitles: true,
      default_burn_subtitles: true,
      subtitle_style: previewState(timeline()).subtitle_style,
      duration_s: 4.9,
      scenes: 3,
      files: [
        { kind: "final", name: "proyecto.mp4", url: "/api/projects/7/render/files/proyecto.mp4", size_bytes: 8 * 1024 * 1024, duration_s: 4.9, width: 1080, height: 1920, updated_at: "2026-09-26T10:00:00", quality: "high" },
        { kind: "thumbnail", name: "miniatura.jpg", url: "/api/projects/7/render/files/miniatura.jpg", size_bytes: 90000, duration_s: null, width: 1080, height: 1920, updated_at: "2026-09-26T10:00:00" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          puts.push({ path, body });
          if (path.endsWith("/transitions") && body.default) {
            transitions = { ...transitions, default: body.default, cuts: transitions.cuts.map((c) => ({ ...c, transition: c.chosen ?? body.default, duration_s: 0.5 })) };
          }
          if (path.endsWith("/transition")) {
            const id = Number(path.split("/")[3]);
            transitions = { ...transitions, cuts: transitions.cuts.map((c) => (c.scene_id === id ? { ...c, chosen: body.transition, transition: body.transition, duration_s: 0.5 } : c)) };
          }
          return new Response(JSON.stringify(transitions));
        }
        if (path.endsWith("/transitions")) return new Response(JSON.stringify(transitions));
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
        if (path.endsWith("/framing")) {
          return new Response(JSON.stringify({
            scene_id: 11, asset_id: 1, kind: "video", mode: "none", crop: null, trim_in_s: null, trim_out_s: null,
            source_width: 1080, source_height: 1920, source_duration_s: 12, scene_duration_s: 1.3,
            target_width: 1080, target_height: 1920, orientation_mismatch: false, suggested_crop: null,
            rendered: false, approved_url: "/x",
          }));
        }
        if (path.endsWith("/timeline/preview")) return new Response(JSON.stringify(previewState(server)));
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

  const panel = async () => screen.findByRole("region", { name: "Render" });
  const openSection = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  const clock = () => screen.getByTestId("preview-clock").textContent;

  it("reproductor: vista previa, pestaña Render y controles", async () => {
    server = timeline();
    renderStage();
    expect(await screen.findByText("9:16 · 1080×1920 · 30 fps")).toBeTruthy();
    expect(await screen.findByTestId("preview-canvas")).toBeTruthy();
    expect(clock()).toBe("0:00.0 / 0:04.9");
    expect(screen.getByText(/Escena 1 de 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Render" }));
    expect(await screen.findByTestId("rendered-video")).toBeTruthy();
  });

  it("Espacio reproduce y pausa; ← → cambian de escena", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(clock()).toBe("0:01.3 / 0:04.9");
    expect(screen.getByText(/Escena 2 de 3/)).toBeTruthy();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByLabelText("Pausar")).toBeTruthy();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByLabelText("Reproducir")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(clock()).toBe("0:00.0 / 0:04.9");
  });

  it("pistas: clic en una escena mueve el cabezal; las tijeras abren «Ajustar tramo»", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    fireEvent.click(screen.getByLabelText("Ir a la escena 3"));
    expect(clock()).toBe("0:02.6 / 0:04.9");
    expect(screen.getByTestId("playhead").style.left).toMatch(/^53\.06/);
    expect(screen.queryByLabelText("Ajustar tramo de la escena 2")).toBeNull(); // foto
    fireEvent.click(screen.getByLabelText("Ajustar tramo de la escena 1"));
    expect(await screen.findByText(/Ajustar tramo · Escena 1/)).toBeTruthy();
  });

  it("muestra pistas, marcadores y estadísticas", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    await screen.findByLabelText(/Transición entre las escenas 1 y 2/);
    // Tres escenas y una marca por cada corte.
    const blocks = [...screen.getByTestId("track-video").children].filter((el) => !el.getAttribute("aria-label")?.startsWith("Transición"));
    expect(blocks).toHaveLength(3);
    expect((blocks[2] as HTMLElement).style.left).toMatch(/^53\.06/);
    expect(screen.getByText("«SIN RESPUESTA»")).toBeTruthy();
    expect(screen.getByText("voz · 0:05")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    openSection("Marcadores");
    expect(screen.getByText(/Texto: «SIN RESPUESTA»/)).toBeTruthy();
    openSection("Exportar a editor");
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
    openSection("Exportar a editor");
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

  it("varios avisos quedan en una línea que se despliega", async () => {
    server = timeline({
      warnings: [
        "Escena 1: el video alcanza para 1.0 s de 1.3 s; el último cuadro queda congelado",
        "Escena 2: no tiene medio aprobado",
      ],
    });
    renderStage();
    expect(await screen.findByText("2 avisos en el timeline")).toBeTruthy();
    expect(screen.queryByText(/Escena 2: no tiene medio/)).toBeNull();
    fireEvent.click(screen.getByText("Ver detalles"));
    expect(screen.getByText(/Escena 2: no tiene medio/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ocultar"));
    expect(screen.queryByText(/Escena 2: no tiene medio/)).toBeNull();
  });

  it("render: calidad elegida, progreso y archivos", async () => {
    server = timeline();
    renderStage();
    const render = await panel();
    fireEvent.click(within(render).getByRole("radio", { name: /4K/ }));
    expect(within(render).getByText(/YouTube le da más bitrate/)).toBeTruthy();
    expect(useUiStore.getState().renderQuality).toBe("max"); // se recuerda
    fireEvent.click(within(render).getByText("Renderizar"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    expect(posts.find((p) => p.path.endsWith("/render"))!.body).toMatchObject({ quality: "max", burn_subtitles: true });
    expect(await within(render).findByText("4K · Escena 2 de 3…")).toBeTruthy();
    expect((within(render).getByRole("radio", { name: /Alta/ }) as HTMLButtonElement).disabled).toBe(true);
    openSection("Archivos del render");
    expect(screen.getByText(/render\/proyecto\.mp4 · 8.00 MB/)).toBeTruthy();
    expect(screen.getByText(/Final · Alta · 1080×1920/)).toBeTruthy();
    expect(screen.getByAltText("Miniatura sugerida")).toBeTruthy();
  });

  it("subtítulos: plegados por defecto; el estilo se ve en la vista previa y va con el render", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    expect(screen.queryByLabelText("Estilo de subtítulos")).toBeNull(); // plegado
    // La vista previa ya muestra la primera frase (3 palabras, mayúsculas).
    const subtitle = await screen.findByTestId("preview-subtitle");
    expect(subtitle.textContent).toBe("ESTO NO ES");
    fireEvent.click(subtitle); // clic en el subtítulo abre su estilo
    const styleBox = screen.getByLabelText("Estilo de subtítulos");
    fireEvent.click(within(styleBox).getByLabelText("Mayúsculas"));
    expect(screen.getByTestId("preview-subtitle").textContent).toBe("Esto no es");
    fireEvent.click(within(styleBox).getByLabelText("Color del resaltado #22E36B"));
    fireEvent.click(within(styleBox).getByRole("radio", { name: "Centro" }));
    fireEvent.click(within(await panel()).getByText("Renderizar"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    const body = posts.find((p) => p.path.endsWith("/render"))!.body as { subtitle_style: Record<string, unknown> };
    expect(body.subtitle_style).toMatchObject({ uppercase: false, highlight_color: "#22E36B", position: "middle" });
  });

  it("texto en pantalla: animación y fondo en la vista previa, y van con el render", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    fireEvent.click(screen.getByLabelText("Escena siguiente"));
    fireEvent.click(screen.getByLabelText("Escena siguiente"));
    const text = await screen.findByTestId("scene-text");
    expect(text.textContent).toBe("SIN RESPUESTA");
    expect(text.style.top).toBe("42%"); // escena de texto: centrado, sobre los subtítulos

    openSection("Texto en pantalla");
    const box = screen.getByLabelText("Estilo del texto en pantalla");
    fireEvent.click(within(box).getByRole("radio", { name: "Máquina de escribir" }));
    fireEvent.click(within(box).getByLabelText("Fondo del texto"));
    // Letra a letra: lo que falta queda transparente (las líneas no se mueven).
    const typed = screen.getByTestId("scene-text");
    expect(typed.textContent).toBe("SIN RESPUESTA");
    expect((typed.querySelector("span span") as HTMLElement).style.opacity).toBe("0");

    fireEvent.click(within(await panel()).getByText("Renderizar"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    const body = posts.find((p) => p.path.endsWith("/render"))!.body as { text_style: Record<string, unknown> };
    expect(body.text_style).toMatchObject({ animation: "typewriter", box: true, font: "Montserrat" });
  });

  it("transiciones: la de por defecto, la de un corte y las marcas en la pista", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    // Marcas en cada corte de la pista de video (sin transición: corte directo).
    expect(await screen.findByLabelText("Transición entre las escenas 1 y 2: Corte directo")).toBeTruthy();

    openSection("Transiciones");
    const box = screen.getByLabelText("Transiciones");
    // Radix Select no se abre en jsdom con clic: se elige con el teclado.
    fireEvent.keyDown(within(box).getByLabelText("Transición por defecto"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Fundido cruzado" }));
    await waitFor(() => expect(puts).toContainEqual({ path: "/api/projects/7/transitions", body: { default: "fade" } }));
    expect(await screen.findByLabelText("Transición entre las escenas 1 y 2: Fundido cruzado")).toBeTruthy();

    // Otro corte (imagen → texto) con la suya.
    expect(within(box).getByTestId("cut-2").textContent).toContain("Imagen → Texto");
    fireEvent.keyDown(within(box).getByLabelText("Transición después de la escena 2"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Círculo que se abre" }));
    await waitFor(() => expect(puts).toContainEqual({ path: "/api/scenes/12/transition", body: { transition: "circleopen" } }));
    expect(await screen.findByLabelText("Transición entre las escenas 2 y 3: Círculo que se abre")).toBeTruthy();
    expect(screen.getByText("Aplicar la de por defecto a todos los cortes")).toBeTruthy();
  });

  it("vista previa: durante la transición se ven las dos escenas", async () => {
    server = timeline();
    const base = previewState(server);
    const withFade = { ...base, scenes: base.scenes.map((sc) => (sc.position === 2 ? { ...sc, transition_in: "fade", transition_in_s: 0.4 } : sc)) };
    render(<PreviewCanvas preview={withFade} time={1.4} playing={false} burnSubtitles={false} style={withFade.subtitle_style} />);
    const outgoing = screen.getByTestId("preview-outgoing");
    expect(outgoing.dataset.position).toBe("1");
    const incoming = screen.getByTestId("preview-scene");
    expect(incoming.dataset.position).toBe("2");
    expect(Number(incoming.style.opacity)).toBeCloseTo(0.25);
    cleanup();
    // Pasada la transición, solo la escena actual.
    render(<PreviewCanvas preview={withFade} time={1.8} playing={false} burnSubtitles={false} style={withFade.subtitle_style} />);
    expect(screen.queryByTestId("preview-outgoing")).toBeNull();
  });

  it("look del video: estilo rápido en la vista previa, sin tocar los subtítulos, y va con el render", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    const layer = screen.getByTestId("look-layer");
    expect(layer.style.filter).toBe("none");
    openSection("Look del video");
    const box = screen.getByLabelText("Look del video");
    fireEvent.click(within(box).getByRole("radio", { name: "Crimen oscuro" }));
    expect(screen.getByTestId("look-layer").style.filter).toBe("saturate(0.4) contrast(1.35) brightness(0.85)");
    expect(screen.getByTestId("look-vignette")).toBeTruthy();
    expect(screen.getByTestId("look-grain")).toBeTruthy();
    // Los subtítulos quedan por fuera del clip de ajuste.
    expect(layer.contains(await screen.findByTestId("preview-subtitle"))).toBe(false);
    // Un control ajusta el estilo elegido.
    fireEvent.change(within(box).getByLabelText("Saturación"), { target: { value: "60" } });
    expect(screen.getByRole("button", { name: /^Look del video/ }).textContent).toContain("Crimen oscuro (ajustado)");

    fireEvent.click(within(await panel()).getByText("Renderizar"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    const body = posts.find((p) => p.path.endsWith("/render"))!.body as { look: Record<string, unknown> };
    expect(body.look).toMatchObject({ preset: "crimen", saturation: 60, vignette: 75, zoom_photos: true });
  });

  it("estilo rápido «Reel cursiva»: fuente, cursiva, sombra y pop en la vista previa y el render", async () => {
    server = timeline();
    renderStage();
    fireEvent.click(await screen.findByTestId("preview-subtitle"));
    const styleBox = screen.getByLabelText("Estilo de subtítulos");
    fireEvent.click(within(styleBox).getByRole("button", { name: "Reel cursiva" }));
    expect(within(styleBox).getByRole("button", { name: "Reel cursiva" }).getAttribute("aria-pressed")).toBe("true");
    const text = screen.getByTestId("preview-subtitle").firstElementChild as HTMLElement;
    expect(text.style.fontStyle).toBe("italic");
    expect(text.style.fontFamily).toContain("Montserrat");
    const active = screen.getByTestId("preview-subtitle").querySelector("[data-active]") as HTMLElement;
    expect(active.style.animation).toContain("subtitle-pop");
    expect(within(styleBox).getByRole("radio", { name: "Sombra" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(await panel()).getByText("Renderizar"));
    await waitFor(() => expect(posts.some((p) => p.path.endsWith("/render"))).toBe(true));
    const body = posts.find((p) => p.path.endsWith("/render"))!.body as { subtitle_style: Record<string, unknown> };
    expect(body.subtitle_style).toMatchObject({ font: "Montserrat", italic: true, edge: "shadow", animation: "pop" });
  });

  it("la pista de subtítulos abre su configuración; sin quemarlos no hay estilo ni subtítulo", async () => {
    server = timeline();
    renderStage();
    await screen.findByTestId("preview-canvas");
    fireEvent.click(within(screen.getByTestId("track-subtitles")).getAllByRole("button")[0]);
    expect(screen.getByLabelText("Estilo de subtítulos")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Quemar subtítulos"));
    expect(screen.queryByLabelText("Estilo de subtítulos")).toBeNull();
    expect(screen.queryByTestId("preview-subtitle")).toBeNull();
  });

  it("cancelar un render en curso", async () => {
    server = timeline();
    renderStage();
    const render = await panel();
    fireEvent.click(within(render).getByText("Renderizar"));
    fireEvent.click(await within(render).findByText("Cancelar render"));
    await waitFor(() => expect(posts.some((p) => p.path === "/api/jobs/9:cancel")).toBe(true));
  });

  it("render bloqueado hasta aprobar los medios", async () => {
    server = timeline();
    renderState = { ...renderState, can_render: false, reason: "Aprueba los medios antes de renderizar", files: [] };
    renderStage();
    const render = await panel();
    expect(within(render).getByText("Aprueba los medios antes de renderizar")).toBeTruthy();
    expect((within(render).getByText("Renderizar").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
