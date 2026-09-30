import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FramingState } from "@/lib/api";
import { TrimDialog } from "./TrimDialog";
import {
  centerRangeAt,
  fitToScene,
  initialRange,
  moveRange,
  resizeEnd,
  resizeStart,
  trimToSave,
} from "./trimMeta";

describe("cálculos del tramo", () => {
  it("tramo inicial: el guardado o el largo de la escena desde el inicio", () => {
    expect(initialRange(15, 4, null, null)).toEqual({ start: 0, end: 4 });
    expect(initialRange(3, 4, null, null)).toEqual({ start: 0, end: 3 }); // clip más corto
    expect(initialRange(15, 4, 6, 10)).toEqual({ start: 6, end: 10 });
    expect(initialRange(15, 4, 6, null)).toEqual({ start: 6, end: 15 });
  });

  it("mover conserva el largo y no se sale del clip", () => {
    expect(moveRange({ start: 0, end: 4 }, 5, 15)).toEqual({ start: 5, end: 9 });
    expect(moveRange({ start: 10, end: 14 }, 5, 15)).toEqual({ start: 11, end: 15 });
    expect(moveRange({ start: 1, end: 5 }, -3, 15)).toEqual({ start: 0, end: 4 });
    expect(centerRangeAt({ start: 0, end: 4 }, 10, 15)).toEqual({ start: 8, end: 12 });
  });

  it("estirar respeta el mínimo de 0,5 s", () => {
    expect(resizeStart({ start: 2, end: 6 }, 5.9)).toEqual({ start: 5.5, end: 6 });
    expect(resizeEnd({ start: 2, end: 6 }, 20, 15)).toEqual({ start: 2, end: 15 });
    expect(fitToScene({ start: 13, end: 14 }, 4, 15)).toEqual({ start: 11, end: 15 });
  });

  it("el clip completo se guarda como «sin tramo»", () => {
    expect(trimToSave({ start: 0, end: 15 }, 15)).toEqual({ trim_in_s: null, trim_out_s: null });
    expect(trimToSave({ start: 0, end: 4 }, 15)).toEqual({ trim_in_s: null, trim_out_s: 4 });
    expect(trimToSave({ start: 8, end: 12 }, 15)).toEqual({ trim_in_s: 8, trim_out_s: 12 });
  });
});

describe("editor «Ajustar tramo»", () => {
  let puts: { path: string; body: unknown }[];
  let posts: { path: string; body: unknown }[];
  const framing = (over: Partial<FramingState> = {}): FramingState => ({
    scene_id: 3, asset_id: 9, kind: "video", mode: "none", crop: null, trim_in_s: null, trim_out_s: null,
    source_width: 1080, source_height: 1920, source_duration_s: 15, scene_duration_s: 4,
    target_width: 1080, target_height: 1920, orientation_mismatch: false, suggested_crop: null,
    rendered: false, approved_url: "/x",
    can_extend_next: false, next_scene_position: null, next_scene_has_media: false, extend_available_s: null,
    ...over,
  });
  let state: FramingState;

  beforeEach(() => {
    puts = [];
    posts = [];
    state = framing();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          puts.push({ path, body });
          return new Response(JSON.stringify({ framing: { ...state, ...body }, job: null }));
        }
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push({ path, body });
          const startS = (body.trim_in_s ?? 0) + (state.scene_duration_s ?? 0);
          return new Response(
            JSON.stringify({
              current: { ...state, ...body },
              current_job: null,
              next_scene_id: 4,
              next_asset_id: 40,
              next_scene_position: state.next_scene_position,
              start_s: startS,
              next: { ...state, scene_id: 4, asset_id: 40, trim_in_s: startS, trim_out_s: null },
              next_job: null,
            }),
          );
        }
        return new Response(JSON.stringify(state));
      }),
    );
    // jsdom no mide: la tira mide 300 px → 1 px = 0,05 s de un clip de 15 s.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, width: 300, top: 0, height: 64, right: 300, bottom: 64, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderDialog(onClose = vi.fn(), queue?: { index: number; total: number }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TrimDialog
          projectId={1}
          target={{ sceneId: 3, assetId: 9, fileUrl: "/api/assets/9/file", position: 16 }}
          queue={queue}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    return onClose;
  }

  it("muestra la ventana del largo de la escena sobre la tira de fotogramas", async () => {
    renderDialog();
    const win = await screen.findByTestId("trim-window");
    expect(win.style.left).toBe("0%");
    expect(Number.parseFloat(win.style.width)).toBeCloseTo((4 / 15) * 100);
    expect(win.style.minWidth).toBe("18px");
    expect(win.textContent).toContain("4.0 s");
    expect((screen.getByTestId("trim-strip") as HTMLImageElement).src).toContain("/api/assets/9/filmstrip");
    expect(screen.getByText("Generando fotogramas…")).toBeTruthy();
    fireEvent.load(screen.getByTestId("trim-strip"));
    expect(screen.queryByText("Generando fotogramas…")).toBeNull();
    expect(screen.getByText(/Escena 16/)).toBeTruthy();
  });

  it("arrastrar mueve el tramo y se guarda conservando el encuadre", async () => {
    state = framing({ mode: "blur" });
    const onClose = renderDialog();
    const win = await screen.findByTestId("trim-window");
    const track = screen.getByTestId("trim-track");
    fireEvent.pointerDown(win, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 200, pointerId: 1 }); // +180 px = +9 s
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(screen.getByTestId("trim-times").textContent).toBe("0:09.0 – 0:13.0");

    fireEvent.click(screen.getByText("Guardar tramo"));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      path: "/api/scenes/3/assets/9/framing",
      body: { mode: "blur", crop: null, trim_in_s: 9, trim_out_s: 13 },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("mover el tramo permite restablecerlo al tamaño real de la escena", async () => {
    renderDialog();
    const win = await screen.findByTestId("trim-window");
    const track = screen.getByTestId("trim-track");
    expect(screen.queryByText("Restablecer tramo")).toBeNull(); // recién abierto: nada que restablecer

    fireEvent.pointerDown(win, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 200, pointerId: 1 }); // +180 px = +9 s (mismo largo)
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(screen.getByTestId("trim-times").textContent).toBe("0:09.0 – 0:13.0");
    expect(screen.queryByText(/El tramo dura/)).toBeNull(); // el largo sigue siendo el de la escena

    fireEvent.click(screen.getByText("Restablecer tramo"));
    expect(screen.getByTestId("trim-times").textContent).toBe("0:00.0 – 0:04.0");
    expect(screen.queryByText("Restablecer tramo")).toBeNull();
  });

  it("estirar el final avisa si no coincide con la escena y se puede reajustar", async () => {
    renderDialog();
    await screen.findByTestId("trim-window");
    const track = screen.getByTestId("trim-track");
    fireEvent.pointerDown(screen.getByLabelText("Mover el final"), { clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 120, pointerId: 1 }); // +2 s
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(screen.getByTestId("trim-times").textContent).toBe("0:00.0 – 0:06.0");
    expect(screen.getByText(/El tramo dura 6.0 s y la escena 4.0 s/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ajustar al largo de la escena"));
    expect(screen.getByTestId("trim-times").textContent).toBe("0:00.0 – 0:04.0");
  });

  it("clic en la tira centra el tramo y las flechas lo afinan", async () => {
    renderDialog();
    await screen.findByTestId("trim-window");
    fireEvent.click(screen.getByTestId("trim-track"), { clientX: 200 }); // t = 10 s
    expect(screen.getByTestId("trim-times").textContent).toBe("0:08.0 – 0:12.0");
    const group = screen.getByRole("group", { name: "Línea de tiempo del clip" });
    fireEvent.keyDown(group, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByTestId("trim-times").textContent).toBe("0:08.9 – 0:12.9");
  });

  it("abre con el tramo guardado y «Usar el clip completo» lo quita", async () => {
    state = framing({ trim_in_s: 5, trim_out_s: 9 });
    renderDialog();
    await screen.findByTestId("trim-window");
    expect(screen.getByTestId("trim-times").textContent).toBe("0:05.0 – 0:09.0");
    fireEvent.click(screen.getByText("Usar el clip completo"));
    fireEvent.click(screen.getByText("Guardar tramo"));
    await waitFor(() => expect(puts[0]?.body).toMatchObject({ trim_in_s: null, trim_out_s: null }));
  });

  it("en la cola tras descargar muestra «1 de 3» y permite saltar", async () => {
    const onClose = renderDialog(vi.fn(), { index: 0, total: 3 });
    expect(await screen.findByText("1 de 3")).toBeTruthy();
    fireEvent.click(screen.getByText("Saltar"));
    expect(onClose).toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });

  it("sin metraje sobrante para la siguiente escena, no ofrece continuar", async () => {
    state = framing({ can_extend_next: false });
    renderDialog();
    await screen.findByTestId("trim-window");
    expect(screen.queryByTestId("extend-next")).toBeNull();
  });

  it("con metraje de sobra, «Continuar en la escena…» lo asigna sin pedir confirmación", async () => {
    state = framing({ can_extend_next: true, next_scene_position: 17, next_scene_has_media: false });
    const onClose = renderDialog();
    await screen.findByTestId("trim-window");
    expect(screen.getByTestId("extend-next").textContent).toContain("Sobran 11.0 s");
    fireEvent.click(screen.getByText("Continuar en la escena 17"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/api/scenes/3/assets/9:extend-next",
      body: { mode: "none", crop: null, trim_in_s: null, trim_out_s: 4 },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("si la escena siguiente ya tiene medio, pide confirmar antes de reemplazarlo", async () => {
    state = framing({ can_extend_next: true, next_scene_position: 17, next_scene_has_media: true });
    renderDialog();
    await screen.findByTestId("trim-window");
    expect(screen.getByTestId("extend-next").textContent).toContain("reemplazando su medio actual");
    fireEvent.click(screen.getByText("Continuar en la escena 17"));
    expect(posts).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId("extend-next")).getByText("Cancelar"));
    expect(screen.getByText("Continuar en la escena 17")).toBeTruthy();
    fireEvent.click(screen.getByText("Continuar en la escena 17"));
    fireEvent.click(screen.getByText("Sí, reemplazar y continuar"));
    await waitFor(() => expect(posts).toHaveLength(1));
  });
});
