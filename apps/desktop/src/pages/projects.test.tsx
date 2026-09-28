import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { ProjectsPage } from "./Projects";

const project = (over: Partial<Project>): Project => ({
  id: 3,
  channel_id: 1,
  channel_name: "Crimen Real",
  channel_slug: "crimen-real",
  title: "María Marta García Belsunce",
  slug: "maria-marta",
  format: "reel",
  status: "PUBLICADO",
  topic: null,
  research_notes: null,
  target_duration_s: 60,
  target_publish_at: null,
  priority: 2,
  tags: [],
  folder_path: "",
  parent_project_id: null,
  created_at: "",
  updated_at: "2026-09-28T10:00:00",
  publications: [
    { platform: "youtube", status: "published", url: "https://youtu.be/x" },
    { platform: "tiktok", status: "draft", url: null },
  ],
  cover_url: "/api/projects/3/cover?v=1",
  media_thumbs: ["/api/assets/10/thumb", "/api/assets/11/thumb"],
  media_count: 19,
  ...over,
});

describe("proyectos: miniaturas y eliminar", () => {
  let calls: { method: string; path: string }[];

  beforeEach(() => {
    calls = [];
    useUiStore.setState({ projectsView: "list", selectedChannelId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname });
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (url.pathname === "/api/projects") {
          return new Response(JSON.stringify([project({}), project({ id: 4, title: "El caso D. B. Cooper", format: "video", status: "IDEA", cover_url: null, media_thumbs: [], media_count: 0, publications: [] })]));
        }
        return new Response("[]");
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/proyectos"]}>
          <Routes>
            <Route path="/proyectos" element={<ProjectsPage />} />
            <Route path="/proyectos/:id" element={<p>proyecto abierto</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("vista en miniaturas: portada, medios y avance de publicación; se recuerda", async () => {
    renderPage();
    await screen.findByText("María Marta García Belsunce");
    fireEvent.click(screen.getByRole("radio", { name: "Miniaturas" }));
    const grid = await screen.findByTestId("projects-grid");
    const card = within(grid).getByRole("button", { name: "Abrir María Marta García Belsunce" });
    expect((card.querySelector("img") as HTMLImageElement).src).toContain("/api/projects/3/cover");
    expect(within(card).getByTestId("media-strip").textContent).toContain("+17");
    expect(within(card).getByTestId("publish-badges").textContent).toBe("1/2");
    expect(within(grid).getByRole("button", { name: "Abrir El caso D. B. Cooper" }).textContent).toContain("Sin medios aprobados");
    expect(useUiStore.getState().projectsView).toBe("grid");
    fireEvent.click(card);
    expect(await screen.findByText("proyecto abierto")).toBeTruthy();
  });

  it("eliminar desde la lista con doble comprobación (escribir ELIMINAR), aunque esté publicado", async () => {
    renderPage();
    await screen.findByText("María Marta García Belsunce");
    const row = screen.getByText("María Marta García Belsunce").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Eliminar proyecto"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Está publicado en 1 plataforma/)).toBeTruthy();
    expect(within(dialog).getByText(/medios \(19\)/)).toBeTruthy();
    const confirm = within(dialog).getAllByRole("button", { name: /Eliminar proyecto/ }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Escribe ELIMINAR para confirmar"), { target: { value: "eliminar" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toContainEqual({ method: "DELETE", path: "/api/projects/3" }));
    // No abrió el proyecto al pulsar la papelera de la fila.
    expect(screen.queryByText("proyecto abierto")).toBeNull();
  });
});
