import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayItem, OverlayTrack, PreviewState, Project, Sound, TimelineState, TransitionsState } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { DEFAULT_TEXT_OVERLAY } from "./overlayMeta";
import { TimelineStage } from "./TimelineStage";

const project = { id: 7, status: "VOZ_LISTA", title: "P", format: "reel", channel_id: 1 } as Project;

const textItem = (over: Partial<OverlayItem> = {}): OverlayItem => ({
  id: 101, track_id: 1, start_s: 0.5, duration_s: 1.5, text: "Caso Priscila", style: { ...DEFAULT_TEXT_OVERLAY },
  sound_id: null, sound_title: null, sound_url: null, sound_duration_s: null, volume: 100, fade_in_s: 0, fade_out_s: 0, ...over,
});

const baseTracks = (): OverlayTrack[] => [
  { id: 1, kind: "text", name: "Texto 1", position: 1, items: [textItem()] },
  { id: 2, kind: "sfx", name: "Efectos 1", position: 2, items: [] },
];

const timeline = (tracks: OverlayTrack[]): TimelineState => ({
  project_id: 7, can_export: true, reason: null, fps: 30, width: 1080, height: 1920, duration_s: 4.9, has_voice: true,
  voice_duration_s: 4.9,
  scenes: [
    { position: 1, kind: "video", start_s: 0, duration_s: 1.3, clip_duration_s: 1.3, file_name: "a.mp4", thumb_url: null, text: null, scene_id: 11, asset_id: 1, is_video: true, effect: null },
    { position: 2, kind: "image", start_s: 1.3, duration_s: 1.3, clip_duration_s: 1.3, file_name: "b.jpg", thumb_url: null, text: null, scene_id: 12, asset_id: 2, is_video: false, effect: "vhs" },
    { position: 3, kind: "text", start_s: 2.6, duration_s: 2.3, clip_duration_s: null, file_name: null, thumb_url: null, text: "SIN RESPUESTA", scene_id: 13 },
  ],
  markers: [], warnings: [], folder: "x", exports: [], overlay_tracks: tracks, editable: true,
});

const preview = (t: TimelineState): PreviewState => ({
  project_id: 7, width: 1080, height: 1920, fps: 30, duration_s: 4.9,
  scenes: t.scenes.map((s) => ({ position: s.position, scene_id: s.scene_id ?? null, kind: s.kind, start_s: s.start_s, duration_s: s.duration_s, effect: s.effect ?? null, text: s.text, media: null })),
  voice_url: null, sfx: [], music: [], words: [],
  overlays: (t.overlay_tracks ?? []).filter((tr) => tr.kind === "text").flatMap((tr) =>
    tr.items.map((i) => ({ start_s: i.start_s, duration_s: i.duration_s, text: i.text ?? "", style: i.style!, layer: 1 })),
  ),
  subtitle_style: {
    uppercase: true, words_per_line: 0, font: "Arial", size: "medium", position: "bottom",
    text_color: "#FFFFFF", outline_color: "#000000", highlight: true, highlight_color: "#FFD400", background: false,
  },
  default_burn_subtitles: false, zoom: 0.12, music_volume: 0.35, sfx_volume: 0.9,
});

const transitions: TransitionsState = {
  default: "none",
  duration: 0.5,
  options: [
    { id: "none", label: "Corte directo" },
    { id: "fade", label: "Fundido cruzado" },
  ],
  cuts: [
    { scene_id: 11, position: 1, from_kind: "video", to_kind: "image", at_s: 1.3, chosen: null, transition: null, duration_s: 0, chosen_s: null },
    { scene_id: 12, position: 2, from_kind: "image", to_kind: "text", at_s: 2.6, chosen: null, transition: null, duration_s: 0, chosen_s: null },
  ],
};

const sound = { id: 5, kind: "sfx", title: "golpe seco", file_url: "/api/sounds/5/file", provider: "manual", source_url: null, author: null, license: null, duration_s: 0.8, tags: ["impact"], mood: null, bpm: null, size_bytes: 10, used_in: 0, created_at: "" } as Sound;

describe("edición del timeline (como CapCut)", () => {
  let tracks: OverlayTrack[];
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    tracks = baseTracks();
    calls = [];
    useUiStore.setState({ renderQuality: "standard" });
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    HTMLMediaElement.prototype.pause = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (method !== "GET") calls.push({ method, path, body });
        const ok = (d: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(d), { status });
        if (method === "POST" && path === "/api/projects/7/overlay-tracks") {
          const track: OverlayTrack = { id: 3, kind: body.kind, name: body.kind === "text" ? "Texto 2" : "Efectos 2", position: 3, items: [] };
          tracks = [...tracks, track];
          return ok(track);
        }
        if (method === "POST" && path.match(/^\/api\/overlay-tracks\/\d+\/items$/)) {
          const item = textItem({ id: 200, track_id: Number(path.split("/")[3]), ...body, text: body.text ?? null, style: body.style ?? null });
          return ok(item);
        }
        if (method === "PATCH" && path.startsWith("/api/overlay-items/")) {
          const id = Number(path.split("/")[3]);
          const item = tracks.flatMap((t) => t.items).find((i) => i.id === id)!;
          return ok({ ...item, ...body });
        }
        if (method === "DELETE") return ok(null, 204);
        if (method === "PUT" && path.endsWith("/effect")) return ok({ scene_id: Number(path.split("/")[3]), effect: body.effect });
        if (method === "PUT" && path.endsWith("/transition")) return ok(transitions);
        if (path === "/api/projects/7/timeline") return ok(timeline(tracks));
        if (path.endsWith("/timeline/preview")) return ok(preview(timeline(tracks)));
        if (path.endsWith("/transitions")) return ok(transitions);
        if (path === "/api/sounds") return ok([sound]);
        if (path === "/api/channels") return ok([]);
        if (path === "/api/jobs") return ok([]);
        if (path.endsWith("/render")) {
          return ok({ project_id: 7, can_render: true, reason: null, has_voice: true, has_subtitles: false, default_burn_subtitles: false,
            subtitle_style: preview(timeline(tracks)).subtitle_style, duration_s: 4.9, scenes: 3, files: [] });
        }
        return ok(timeline(tracks));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderStage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TimelineStage project={project} onGoToMedia={() => {}} />
      </QueryClientProvider>,
    );
  }

  const ready = () => screen.findByTestId("overlay-lane-1");
  const call = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

  it("las pistas propias van con su nombre: textos arriba del video y sonidos debajo de la voz", async () => {
    renderStage();
    await ready();
    const rows = [...screen.getByTestId("tracks").children].map((el) => el.getAttribute("data-testid")).filter((id) => id?.startsWith("track-"));
    expect(rows).toEqual(["track-overlay-1", "track-video", "track-subtitles", "track-markers", "track-sfx", "track-music", "track-voice", "track-overlay-2"]);
    expect(screen.getByTestId("overlay-track-header-1").textContent).toContain("Texto 1");
    expect(screen.getByLabelText("Texto: Caso Priscila · 0:00.5")).toBeTruthy();
    expect(screen.getByText(/Pista vacía · «\+» agrega un sonido/)).toBeTruthy();
    // La vista previa dibuja el texto en su tramo (empieza a los 0,5 s).
    expect(screen.queryByTestId("overlay-text")).toBeNull();
  });

  it("agregar una pista de texto abre el editor y guarda el texto con su formato", async () => {
    renderStage();
    await ready();
    fireEvent.keyDown(screen.getByLabelText("Agregar pista"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pista de texto/ }));
    await waitFor(() => expect(call("POST", "/api/projects/7/overlay-tracks")?.body).toEqual({ kind: "text" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nuevo texto")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Texto"), { target: { value: "11 de diciembre" } });
    fireEvent.click(within(dialog).getByLabelText("Estilo Amarillo reel"));
    expect(within(dialog).getByTestId("text-stage-text").textContent).toBe("11 de diciembre");
    fireEvent.click(within(dialog).getByText("Agregar texto"));
    await waitFor(() => expect(call("POST", "/api/overlay-tracks/3/items")).toBeTruthy());
    const posted = call("POST", "/api/overlay-tracks/3/items")!.body as { text: string; style: { color: string; italic: boolean }; start_s: number; duration_s: number };
    expect(posted.text).toBe("11 de diciembre");
    expect(posted.style.color).toBe("#FFD400");
    expect(posted.style.italic).toBe(true);
    expect([posted.start_s, posted.duration_s]).toEqual([0, 3]);
  });

  it("el editor cambia formato, borde, sombra y animación, y guarda con PATCH", async () => {
    renderStage();
    await ready();
    const item = screen.getByLabelText("Texto: Caso Priscila · 0:00.5");
    fireEvent.pointerDown(item, { clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(item, { clientX: 10, pointerId: 1 });
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Texto") as HTMLTextAreaElement).value).toBe("Caso Priscila");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Estilo" }));
    fireEvent.click(within(dialog).getByLabelText("Mayúsculas"));
    fireEvent.click(within(dialog).getByLabelText("Color: #FF3B30"));
    fireEvent.change(within(dialog).getByLabelText("Tamaño"), { target: { value: "120" } });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Borde y sombra" }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "Sombra" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Animación" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Máquina de escribir" }));
    fireEvent.click(within(dialog).getByText("Guardar"));
    await waitFor(() => expect(call("PATCH", "/api/overlay-items/101")).toBeTruthy());
    const style = (call("PATCH", "/api/overlay-items/101")!.body as { style: Record<string, unknown> }).style;
    expect(style).toMatchObject({ uppercase: true, color: "#FF3B30", size: 120, shadow: true, animation_in: "typewriter" });
  });

  it("arrastrar un texto lo mueve y se pega al corte de escena; Supr lo borra", async () => {
    renderStage();
    await ready();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 490, height: 30, right: 490, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const item = screen.getByLabelText("Texto: Caso Priscila · 0:00.5");
    fireEvent.pointerDown(item, { clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(item, { clientX: 128, pointerId: 1 }); // +78 px = +0,78 s → 1,28 s, se pega al corte de 1,3 s
    fireEvent.pointerUp(item, { clientX: 128, pointerId: 1 });
    await waitFor(() => expect(call("PATCH", "/api/overlay-items/101")?.body).toEqual({ start_s: 1.3 }));
    expect(screen.queryByRole("dialog")).toBeNull(); // arrastrar no abre el editor

    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(call("DELETE", "/api/overlay-items/101")).toBeTruthy());
  });

  it("estirar el final de un texto cambia su duración", async () => {
    renderStage();
    await ready();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 490, height: 30, right: 490, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const handle = within(screen.getByLabelText("Texto: Caso Priscila · 0:00.5")).getByLabelText("Mover el final");
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 250, pointerId: 1 }); // +0,5 s
    fireEvent.pointerUp(handle, { clientX: 250, pointerId: 1 });
    await waitFor(() => expect(call("PATCH", "/api/overlay-items/101")?.body).toEqual({ duration_s: 2 }));
  });

  it("borrar una pista propia pide confirmación", async () => {
    renderStage();
    await ready();
    fireEvent.click(screen.getByLabelText("Eliminar la pista Texto 1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Se borra con sus 1 textos/)).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Eliminar"));
    await waitFor(() => expect(call("DELETE", "/api/overlay-tracks/1")).toBeTruthy());
  });

  it("efectos: el chip de la escena abre la ventana y aplica el efecto al momento", async () => {
    renderStage();
    await ready();
    expect(screen.getByLabelText("Efecto de la escena 2: VHS retro")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Efecto de la escena 1: Sin efecto"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Escena 1 · Video/)).toBeTruthy();
    expect(within(dialog).getByTestId("effect-preview")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Color y textura" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Blanco y negro" }));
    await waitFor(() => expect(call("PUT", "/api/scenes/11/effect")?.body).toEqual({ effect: "blanco_negro" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Velocidad" }));
    expect((within(dialog).getByRole("radio", { name: "Cámara lenta" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("solo los videos pueden ir a cámara lenta", async () => {
    renderStage();
    await ready();
    fireEvent.click(screen.getByLabelText("Efecto de la escena 2: VHS retro"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Velocidad" }));
    expect((within(dialog).getByRole("radio", { name: "Cámara lenta" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("transiciones: la marca del corte abre la ventana en la pestaña de transición", async () => {
    renderStage();
    await ready();
    fireEvent.click(await screen.findByLabelText("Transición entre las escenas 1 y 2: Corte directo"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "Transición" }).getAttribute("aria-selected")).toBe("true");
    expect(within(dialog).getByTestId("transition-preview")).toBeTruthy();
    fireEvent.click(within(within(dialog).getByLabelText("Transiciones")).getByRole("radio", { name: "Fundido cruzado" }));
    await waitFor(() => expect(call("PUT", "/api/scenes/11/transition")?.body).toEqual({ transition: "fade" }));
  });

  it("SFX: el «+» de la pista abre la biblioteca y agrega el sonido con su volumen", async () => {
    renderStage();
    await ready();
    fireEvent.click(screen.getByLabelText("Agregar a Efectos 1"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("radio", { name: /golpe seco/ }));
    fireEvent.change(within(dialog).getByLabelText("Volumen"), { target: { value: "150" } });
    fireEvent.change(within(dialog).getByLabelText("Salida suave"), { target: { value: "0.3" } });
    fireEvent.click(within(dialog).getByText("Agregar sonido"));
    await waitFor(() => expect(call("POST", "/api/overlay-tracks/2/items")).toBeTruthy());
    expect(call("POST", "/api/overlay-tracks/2/items")!.body).toEqual({
      sound_id: 5, start_s: 0, duration_s: 0.8, volume: 150, fade_in_s: 0, fade_out_s: 0.3,
    });
  });

  it("la vista previa dibuja el texto en su tramo", async () => {
    tracks = [{ id: 1, kind: "text", name: "Texto 1", position: 1, items: [textItem({ start_s: 0, duration_s: 2, style: { ...DEFAULT_TEXT_OVERLAY, animation_in: "none" } })] }];
    renderStage();
    expect((await screen.findByTestId("overlay-text")).textContent).toBe("Caso Priscila");
  });

  it("programado o publicado: no se puede editar", async () => {
    tracks = baseTracks();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TimelineStage project={{ ...project, status: "PROGRAMADO" } as Project} onGoToMedia={() => {}} />
      </QueryClientProvider>,
    );
    await ready();
    expect(screen.queryByLabelText("Agregar pista")).toBeNull();
    expect(screen.queryByLabelText("Eliminar la pista Texto 1")).toBeNull();
    expect((screen.getByLabelText("Efecto de la escena 2: VHS retro") as HTMLButtonElement).disabled).toBe(true);
  });
});
