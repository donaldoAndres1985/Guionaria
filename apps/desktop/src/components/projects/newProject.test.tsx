import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

const channel = {
  id: 1,
  name: "Crimen Real",
  platforms: ["youtube"],
  language: "es",
};

describe("diálogo de nuevo proyecto", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([channel]))),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <span data-testid="state">{open ? "abierto" : "cerrado"}</span>
        <NewProjectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  async function renderDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return screen.findByPlaceholderText("De qué trata el video, en una o dos frases.");
  }

  const clickOutside = () => {
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    fireEvent.pointerDown(overlay);
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
  };

  it("un clic fuera no cierra el diálogo ni borra lo escrito", async () => {
    const topic = await renderDialog();
    fireEvent.change(topic, { target: { value: "El caso de D. B. Cooper" } });
    clickOutside();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("¿Descartar el nuevo proyecto?")).toBeNull();
    expect(screen.getByTestId("state").textContent).toBe("abierto");
    expect((topic as HTMLTextAreaElement).value).toBe("El caso de D. B. Cooper");
  });

  it("los textos largos se desplazan dentro del campo en vez de agrandar el diálogo", async () => {
    const topic = await renderDialog();
    expect(topic.className).toContain("max-h-48");
    expect(topic.className).toContain("overflow-y-auto");
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.className).toContain("max-h-[calc(100dvh-2rem)]");
  });

  it("con datos escritos pide confirmación antes de descartarlos", async () => {
    const topic = await renderDialog();
    fireEvent.change(topic, { target: { value: "Algo escrito" } });
    fireEvent.click(screen.getByText("Cancelar"));
    expect(await screen.findByText("¿Descartar el nuevo proyecto?")).toBeTruthy();
    expect(screen.getByTestId("state").textContent).toBe("abierto");

    // Volver al formulario conserva el texto.
    fireEvent.click(screen.getAllByText("Cancelar").at(-1)!);
    await waitFor(() => expect(screen.queryByText("¿Descartar el nuevo proyecto?")).toBeNull());
    expect((topic as HTMLTextAreaElement).value).toBe("Algo escrito");

    fireEvent.keyDown(topic, { key: "Escape" });
    fireEvent.click(await screen.findByText("Descartar"));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("cerrado"));
  });

  it("sin datos escritos se cierra directamente", async () => {
    await renderDialog();
    fireEvent.click(screen.getByText("Cancelar"));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("cerrado"));
    expect(screen.queryByText("¿Descartar el nuevo proyecto?")).toBeNull();
  });
});
