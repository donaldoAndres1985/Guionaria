import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Research } from "@/lib/api";
import { ResearchPanel } from "./ResearchPanel";

const research: Research = {
  created_at: "2026-09-28T10:00:00+00:00",
  dossier: {
    resumen: "Una banda robó el Banco Río de Acassuso sin herir a nadie.",
    datos: [
      { afirmacion: "Ocurrió el 13 de enero de 2006.", certeza: "confirmado", fuentes: [1, 2], nota: null },
      { afirmacion: "El botín superó los 8 millones.", certeza: "en_disputa", fuentes: [2], nota: "Varía según el medio." },
    ],
    fuentes: [
      { id: 1, titulo: "El robo del siglo", medio: "La Nación", url: "https://www.lanacion.com.ar/x", fecha: "2006-01-14", tipo: "prensa" },
      { id: 2, titulo: "Sentencia", medio: "Poder Judicial", url: "https://www.cij.gov.ar/y", fecha: null, tipo: "judicial" },
    ],
    contradicciones: ["El monto del botín varía."],
    incognitas: ["Nunca se recuperó todo el dinero."],
    cuidados: [],
    ganchos: ["Robaron un banco sin disparar un tiro."],
  },
  stats: { confirmado: 1, una_fuente: 0, en_disputa: 1, fuentes: 2 },
};

describe("investigar con fuentes", () => {
  let posts: { path: string; body: unknown }[];
  let jobStatus: string;

  beforeEach(() => {
    posts = [];
    jobStatus = "running";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const job = (status: string) => ({
          id: 5, type: "research", project_id: null, status, progress: 0.1, message: "Claude está buscando fuentes en internet…",
          result: status === "done" ? { datos: 2, fuentes: 2, en_disputa: 1 } : null, error: null, created_at: "",
        });
        if (init?.method === "POST") {
          posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
          if (path.endsWith(":research") || path.endsWith("/research")) return new Response(JSON.stringify(job("queued")), { status: 202 });
          return new Response(null, { status: 204 });
        }
        if (path === "/api/jobs/5") return new Response(JSON.stringify(job(jobStatus)));
        return new Response("[]");
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPanel(props: Partial<React.ComponentProps<typeof ResearchPanel>> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ResearchPanel target={{ kind: "idea", id: 3 }} research={null} {...props} />
      </QueryClientProvider>,
    );
  }

  it("sin ficha invita a investigar y lanza el trabajo de la idea", async () => {
    renderPanel();
    expect(screen.getByText(/Claude busca en internet, verifica cada dato/)).toBeTruthy();
    fireEvent.click(screen.getByText("Investigar con fuentes"));
    await waitFor(() => expect(posts.map((p) => p.path)).toContain("/api/ideas/3:research"));
    expect(await screen.findByText("Investigando…")).toBeTruthy();
    expect(screen.getByText(/gasta cuota de tu plan de Claude/)).toBeTruthy();
  });

  it("en un proyecto usa su ruta", async () => {
    renderPanel({ target: { kind: "project", id: 9 } });
    fireEvent.click(screen.getByText("Investigar con fuentes"));
    await waitFor(() => expect(posts.map((p) => p.path)).toContain("/api/projects/9/research"));
  });

  it("muestra la ficha: certeza, citas que abren la fuente, contradicciones y ganchos", async () => {
    renderPanel({ research });
    const stats = screen.getByTestId("research-stats");
    expect(stats.textContent).toContain("1 confirmado");
    expect(stats.textContent).toContain("1 en disputa");
    expect(stats.textContent).toContain("2 fuentes");
    expect(screen.getByText(/Ocurrió el 13 de enero de 2006/)).toBeTruthy();
    expect(screen.getByText("Varía según el medio.")).toBeTruthy();
    expect(screen.getByText("Contradicciones entre fuentes")).toBeTruthy();
    expect(screen.getByText("· Robaron un banco sin disparar un tiro.")).toBeTruthy();
    expect(screen.getByText("Investigar de nuevo")).toBeTruthy();

    const fact = screen.getByText(/Ocurrió el 13 de enero/).closest("li")!;
    fireEvent.click(within(fact).getByText("[2]"));
    await waitFor(() => expect(posts).toContainEqual({ path: "/api/system/open-url", body: { url: "https://www.cij.gov.ar/y" } }));
    fireEvent.click(screen.getByLabelText("Abrir El robo del siglo"));
    await waitFor(() => expect(posts).toContainEqual({ path: "/api/system/open-url", body: { url: "https://www.lanacion.com.ar/x" } }));
  });

  it("deshabilitado en una idea ya convertida", () => {
    renderPanel({ research, disabled: true });
    expect((screen.getByText("Investigar de nuevo").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
