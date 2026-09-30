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
    { id: 31, platform: "youtube", status: "published", url: "https://youtu.be/x" },
    { id: 32, platform: "tiktok", status: "draft", url: null },
  ],
  cover_url: "/api/projects/3/cover?v=1",
  media_thumbs: ["/api/assets/10/thumb", "/api/assets/11/thumb"],
  media_count: 19,
  ...over,
});

describe("proyectos: miniaturas y eliminar", () => {
  let calls: { method: string; path: string; body?: unknown }[];

  beforeEach(() => {
    calls = [];
    useUiStore.setState({ projectsView: "list", selectedChannelId: null, showPublished: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (url.pathname.includes(":reveal") || url.pathname === "/api/system/open-url") return new Response(null, { status: 204 });
        if (url.pathname.startsWith("/api/publications/")) return new Response(JSON.stringify({ project_id: 3, publications: [] }));
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

  /** Abre el menú ⋯ de la fila (Radix lo abre con el teclado en jsdom). */
  function openMenu(title: string) {
    const row = screen.getByText(title).closest("tr")!;
    fireEvent.keyDown(within(row).getByLabelText(`Opciones de ${title}`), { key: "Enter" });
  }

  it("por defecto oculta los publicados; «Mostrar publicados» los muestra y se recuerda", async () => {
    useUiStore.setState({ showPublished: false });
    renderPage();
    await screen.findByText("El caso D. B. Cooper");
    expect(screen.queryByText("María Marta García Belsunce")).toBeNull();
    expect(screen.getByRole("button", { name: /Todos/ }).textContent).toContain("1");
    const box = screen.getByRole("checkbox", { name: "Mostrar publicados" });
    fireEvent.click(box);
    expect(await screen.findByText("María Marta García Belsunce")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Todos/ }).textContent).toContain("2");
    expect(useUiStore.getState().showPublished).toBe(true);
    fireEvent.click(box);
    expect(screen.queryByText("María Marta García Belsunce")).toBeNull();
    // La pestaña Publicados los muestra aunque la casilla esté apagada.
    fireEvent.click(screen.getByRole("button", { name: /Publicados/ }));
    expect(await screen.findByText("María Marta García Belsunce")).toBeTruthy();
  });

  it("menú ⋯: pegar el enlace de una plataforma sin abrir el proyecto", async () => {
    renderPage();
    await screen.findByText("María Marta García Belsunce");
    openMenu("María Marta García Belsunce");
    const tiktok = await screen.findByRole("menuitem", { name: /TikTok/ });
    expect(tiktok.textContent).toContain("sin enlace");
    fireEvent.keyDown(tiktok, { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pegar enlace/ }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Enlace de TikTok");
    fireEvent.change(input, { target: { value: "tiktok.com/x" } });
    expect(within(dialog).getByText(/dirección completa/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "https://www.tiktok.com/@canal/video/1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar enlace" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/publications/32:published",
        body: { url: "https://www.tiktok.com/@canal/video/1" },
      }),
    );
    expect(screen.queryByText("proyecto abierto")).toBeNull();
  });

  it("menú ⋯: abrir y quitar el enlace publicado, mostrar el video", async () => {
    renderPage();
    await screen.findByText("María Marta García Belsunce");
    openMenu("María Marta García Belsunce");
    fireEvent.keyDown(await screen.findByRole("menuitem", { name: /YouTube/ }), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Abrir en YouTube/ }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "/api/system/open-url", body: { url: "https://youtu.be/x" } }),
    );

    openMenu("María Marta García Belsunce");
    fireEvent.keyDown(await screen.findByRole("menuitem", { name: /YouTube/ }), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Quitar enlace/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/publications/31:reopen")).toBe(true));

    openMenu("María Marta García Belsunce");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Mostrar el video renderizado/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/projects/3/publishing:reveal")).toBe(true));
    expect(screen.queryByText("proyecto abierto")).toBeNull();
  });

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
    openMenu("María Marta García Belsunce");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Eliminar proyecto/ }));
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
