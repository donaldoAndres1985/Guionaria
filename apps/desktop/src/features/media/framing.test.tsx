import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovedMedia, FramingState } from "@/lib/api";
import { FramingDialog } from "./FramingDialog";
import { framingLabel, moveCrop, scaledCrop, trimError } from "./framingMeta";

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
    source_duration_s: null,
    target_width: 1080,
    target_height: 1920,
    orientation_mismatch: true,
    suggested_crop: MAX,
    rendered: false,
    approved_url: "/api/scenes/3/assets/9/approved-file",
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
