import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApproveScenes, useUpdateScene } from "@/hooks/useScenes";
import { STAGE_PANEL_WIDTH, useUiStore } from "@/stores/ui";
import { StagePanel, useStagePanelCompact } from "./StagePanel";

function Harness({ wideView }: { wideView: boolean }) {
  const compact = useStagePanelCompact(wideView);
  return (
    <StagePanel compact={compact}>
      <span>{compact ? "iconos" : "completa"}</span>
    </StagePanel>
  );
}

const panel = () => screen.getByTestId("stage-panel");

describe("barra de etapas", () => {
  beforeEach(() => {
    useUiStore.setState({ stagePanelMode: "expanded", stagePanelWidth: STAGE_PANEL_WIDTH.default });
  });
  afterEach(cleanup);

  it("por defecto se muestra completa también en Escenas y Medios", () => {
    render(<Harness wideView />);
    expect(screen.getByText("completa")).toBeTruthy();
    expect(panel().style.width).toBe(`${STAGE_PANEL_WIDTH.default}px`);
  });

  it("«Contraer» la deja solo con iconos y el modo se recuerda", () => {
    render(<Harness wideView={false} />);
    fireEvent.click(screen.getByText("Contraer"));
    expect(screen.getByText("iconos")).toBeTruthy();
    expect(useUiStore.getState().stagePanelMode).toBe("compact");
    expect(screen.queryByRole("separator")).toBeNull(); // contraída no se redimensiona
  });

  it("en modo automático solo se contrae en las vistas anchas", () => {
    useUiStore.setState({ stagePanelMode: "auto" });
    const { rerender } = render(<Harness wideView={false} />);
    expect(screen.getByText("completa")).toBeTruthy();
    rerender(<Harness wideView />);
    expect(screen.getByText("iconos")).toBeTruthy();
  });

  it("el ancho se ajusta con el teclado, respeta los límites y doble clic lo restablece", () => {
    render(<Harness wideView={false} />);
    const handle = screen.getByRole("separator", { name: "Ajustar ancho de la barra de etapas" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(panel().style.width).toBe(`${STAGE_PANEL_WIDTH.default + 16}px`);
    act(() => useUiStore.getState().setStagePanelWidth(10_000));
    expect(panel().style.width).toBe(`${STAGE_PANEL_WIDTH.max}px`);
    act(() => useUiStore.getState().setStagePanelWidth(10));
    expect(panel().style.width).toBe(`${STAGE_PANEL_WIDTH.min}px`);
    fireEvent.doubleClick(handle);
    expect(panel().style.width).toBe(`${STAGE_PANEL_WIDTH.default}px`);
  });

  it("el ancho sigue al arrastrar el borde", () => {
    render(<Harness wideView={false} />);
    const handle = screen.getByRole("separator");
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 288 });
    // jsdom no implementa PointerEvent con clientX: se usa MouseEvent con el tipo pointermove.
    handle.dispatchEvent(new MouseEvent("pointermove", { clientX: 350, bubbles: true }));
    handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(useUiStore.getState().stagePanelWidth).toBe(350);
  });
});

describe("medios tras cambiar las escenas", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ scenes: [], review_count: 0 }))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["media", 1], { scenes: [] }); // cargada antes de que hubiera escenas
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, wrapper };
  }

  it("aprobar las escenas invalida la lista de medios", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useApproveScenes(1), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(client.getQueryState(["media", 1])?.isInvalidated).toBe(true);
  });

  it("editar una escena también la invalida", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useUpdateScene(1), { wrapper });
    await act(() => result.current.mutateAsync({ id: 3, data: { media_kind: "real" } }));
    expect(client.getQueryState(["media", 1])?.isInvalidated).toBe(true);
  });
});
