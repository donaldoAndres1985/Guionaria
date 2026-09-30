import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovedMedia, FramingState } from "@/lib/api";
import { FramingDialog } from "./FramingDialog";
import { framingLabel, moveCrop, resizeCorner, scaledCrop, trimError } from "./framingMeta";

const MAX = { x: 0.341797, y: 0, w: 0.316406, h: 1 }; // 16:9 dentro de un reel 9:16

describe("utilidades de encuadre", () => {
  it("escala el recorte sin salirse del medio", () => {
    const c = scaledCrop(MAX, 0.5, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.4209, 4);
    expect([c.y, c.w, c.h]).toEqual([0.25, 0.158203, 0.5]);
    // Centro pegado al borde: se ajusta para quedar dentro.
    expect(scaledCrop(MAX, 0.5, 0, 0).x).toBe(0);
    expect(scaledCrop(MAX, 0.5, 1, 1)).toMatchObject({ x: 0.841797, y: 0.5 });
  });

  it("mueve el recorte dentro de los límites", () => {
    expect(moveCrop(MAX, 1, 0).x).toBe(0.683594);
    expect(moveCrop(MAX, -1, 0).x).toBe(0);
    expect(moveCrop(MAX, 0, 0.3).y).toBe(0); // alto completo: no se mueve en vertical
  });

  it("valida el tramo", () => {
    expect(trimError(null, null, 10)).toBeNull();
    expect(trimError(2, 12, 10)).toBe("El video dura 0:10.0");
    expect(trimError(2, 2.2, 10)).toBe("El tramo debe durar al menos 0,5 s");
    expect(trimError(9.8, null, 10)).toBe("El tramo debe durar al menos 0,5 s");
    expect(trimError(Number.NaN, null, 10)).toMatch(/minutos:segundos/);
  });

  it("redimensiona arrastrando una esquina, ancla la contraria y mantiene la proporción", () => {
    const half = scaledCrop(MAX, 0.5, 0.5, 0.5); // { x: 0.4209, y: 0.25, w: 0.158203, h: 0.5 }

    const grown = resizeCorner(half, MAX, "br", 0.1, 0.1);
    expect(grown.x).toBeCloseTo(half.x, 6);
    expect(grown.y).toBeCloseTo(half.y, 6);
    expect(grown.w).toBeGreaterThan(half.w);
    expect(grown.w / grown.h).toBeCloseTo(MAX.w / MAX.h, 5);

    const grownFromTl = resizeCorner(half, MAX, "tl", -0.1, -0.1);
    expect(grownFromTl.x + grownFromTl.w).toBeCloseTo(half.x + half.w, 5);
    expect(grownFromTl.y + grownFromTl.h).toBeCloseTo(half.y + half.h, 5);
    expect(grownFromTl.w / grownFromTl.h).toBeCloseTo(MAX.w / MAX.h, 5);

    // No se sale del medio por ningún lado ni baja de un tamaño mínimo.
    const shrunk = resizeCorner(half, MAX, "br", -0.5, -0.5);
    expect(shrunk.w).toBeGreaterThan(0);
    expect(shrunk.w / shrunk.h).toBeCloseTo(MAX.w / MAX.h, 5);
    const overgrown = resizeCorner(half, MAX, "br", 5, 5);
    expect(overgrown.x + overgrown.w).toBeLessThanOrEqual(1.0001);
    expect(overgrown.y + overgrown.h).toBeLessThanOrEqual(1.0001);
  });

  it("etiqueta del aprobado", () => {
    const a = {
      framing_mode: "none",
      framing_pending: false,
      trim_in_s: null,
      trim_out_s: null,
    } as ApprovedMedia;
    expect(framingLabel(a)).toBeNull();
    expect(framingLabel({ ...a, framing_mode: "crop", trim_in_s: 2.5, trim_out_s: 5 })).toBe(
      "Recortado · Tramo 0:02.5–0:05.0",
    );
    expect(framingLabel({ ...a, framing_mode: "blur" })).toBe("Fondo desenfocado");
    expect(framingLabel({ ...a, framing_pending: true })).toBe("Generando el video encuadrado…");
  });
});

describe("diálogo de encuadre", () => {
  let server: FramingState;
  let puts: unknown[];

  const state = (over: Partial<FramingState> = {}): FramingState => ({
    scene_id: 3,
    asset_id: 9,
    kind: "image",
    mode: "none",
    crop: null,
    trim_in_s: null,
    trim_out_s: null,
    source_width: 1920,
    source_height: 1080,
    source_duration_s: null, scene_duration_s: null,
    target_width: 1080,
    target_height: 1920,
    orientation_mismatch: true,
    suggested_crop: MAX,
    rendered: false,
    approved_url: "/api/scenes/3/assets/9/approved-file",
    can_extend_next: false,
    next_scene_position: null,
    next_scene_has_media: false,
    extend_available_s: null,
    ...over,
  });

  beforeEach(() => {
    puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          puts.push(body);
          const job = server.kind === "video" && body.mode !== "none" ? { id: 5, type: "frame_media", status: "queued" } : null;
          return new Response(JSON.stringify({ framing: { ...server, ...body }, job }));
        }
        return new Response(JSON.stringify(server));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderDialog(onClose = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FramingDialog projectId={1} target={{ sceneId: 3, assetId: 9, fileUrl: "/api/assets/9/file" }} onClose={onClose} />
      </QueryClientProvider>,
    );
    return onClose;
  }

  it("recorta una imagen horizontal para un reel", async () => {
    server = state();
    const close = renderDialog();
    expect(await screen.findByText(/El medio tiene otra orientación/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Recortar/ }));
    const rect = screen.getByTestId("crop-rect");
    expect(parseFloat(rect.style.width)).toBeCloseTo(31.6406, 3);
    fireEvent.change(screen.getByLabelText("Tamaño del recorte"), { target: { value: "50" } });
    expect(screen.getByTestId("crop-rect").style.height).toBe("50%");
    fireEvent.click(screen.getByText("Guardar encuadre"));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ mode: "crop", trim_in_s: null, trim_out_s: null });
    const crop = (puts[0] as { crop: { x: number; y: number; w: number; h: number } }).crop;
    expect(crop.x).toBeCloseTo(0.4209, 4);
    expect([crop.y, crop.w, crop.h]).toEqual([0.25, 0.158203, 0.5]);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("arrastrar una esquina redimensiona el recorte anclando la opuesta", async () => {
    server = state();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    renderDialog();
    fireEvent.click(await screen.findByRole("radio", { name: /Recortar/ }));
    fireEvent.change(screen.getByLabelText("Tamaño del recorte"), { target: { value: "50" } });
    const rect = screen.getByTestId("crop-rect");
    const before = { left: parseFloat(rect.style.left), top: parseFloat(rect.style.top), w: parseFloat(rect.style.width) };

    fireEvent.pointerDown(screen.getByTestId("crop-handle-br"), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(rect, { clientX: 64, clientY: 0, pointerId: 1 }); // +64 px / 640 px = +0.1
    fireEvent.pointerUp(rect, { pointerId: 1 });

    const after = { left: parseFloat(rect.style.left), top: parseFloat(rect.style.top), w: parseFloat(rect.style.width), h: parseFloat(rect.style.height) };
    expect(after.left).toBeCloseTo(before.left, 3); // la esquina arriba-izquierda no se mueve
    expect(after.top).toBeCloseTo(before.top, 3);
    expect(after.w).toBeGreaterThan(before.w); // creció al arrastrar hacia afuera
    expect(after.w / after.h).toBeCloseTo(MAX.w / MAX.h, 3); // mantiene la proporción del formato
  });

  it("la vista previa del encuadre respeta y repite el tramo elegido", async () => {
    server = state({ kind: "video", source_duration_s: 10, mode: "none", trim_in_s: 2.5, trim_out_s: 5 });
    renderDialog();
    await screen.findByText(/Tramo del video/);
    expect(document.body.textContent).toContain("repite el tramo elegido");
    expect(document.body.textContent).toContain("0:02.5");
    expect(document.body.textContent).toContain("0:05.0");

    const video = document.querySelector("video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video); // al cargar, salta directo al inicio del tramo
    expect(video.currentTime).toBe(2.5);

    video.currentTime = 6; // se pasó del tramo: vuelve al inicio
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(2.5);

    video.currentTime = 1; // antes del tramo: también vuelve
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(2.5);

    video.currentTime = 3; // dentro del tramo: no se toca
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(3);
  });

  it("sin tramo elegido, la vista previa no muestra el aviso", async () => {
    server = state({ kind: "video", source_duration_s: 10, mode: "none" });
    renderDialog();
    await screen.findByText(/Tramo del video/);
    expect(document.body.textContent).not.toContain("repite el tramo elegido");
  });

  it("fondo desenfocado muestra la vista previa en el formato de destino", async () => {
    server = state();
    renderDialog();
    fireEvent.click(await screen.findByRole("radio", { name: /Fondo desenfocado/ }));
    expect((screen.getByTestId("blur-preview") as HTMLElement).style.aspectRatio).toMatch(/^0\.5625/);
    fireEvent.click(screen.getByText("Guardar encuadre"));
    await waitFor(() => expect(puts[0]).toMatchObject({ mode: "blur", crop: null }));
  });

  it("tramo de un video y validación", async () => {
    server = state({ kind: "video", source_duration_s: 10, mode: "none" });
    renderDialog();
    expect(await screen.findByText(/Tramo del video/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Inicio"), { target: { value: "0:02.5" } });
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "0:12" } });
    expect(screen.getByText("El video dura 0:10.0")).toBeTruthy();
    expect((screen.getByText("Guardar encuadre").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "0:05" } });
    fireEvent.click(screen.getByText("Guardar encuadre"));
    await waitFor(() => expect(puts[0]).toEqual({ mode: "none", crop: null, trim_in_s: 2.5, trim_out_s: 5 }));
  });

  it("con encuadre, el video avisa que se genera en segundo plano", async () => {
    server = state({ kind: "video", source_duration_s: 10 });
    renderDialog();
    fireEvent.click(await screen.findByRole("radio", { name: /Recortar/ }));
    expect(screen.getByText(/FFmpeg genera el video encuadrado en segundo plano/)).toBeTruthy();
  });
});
