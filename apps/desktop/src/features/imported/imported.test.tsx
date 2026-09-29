import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportVideoDialog } from "@/components/projects/ImportVideoDialog";
import type { Project } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { ImportedVideoPanel } from "./ImportedVideoPanel";

const project = { id: 9, title: "Mi reel", status: "RENDERIZADO", format: "reel", origin: "importado", channel_id: 1 } as Project;

describe("video terminado importado", () => {
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    useUiStore.setState({ selectedChannelId: 2 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname, body: init?.body });
        const ok = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
        if (url.pathname === "/api/channels") {
          return ok([
            { id: 1, name: "Crimen Real" },
            { id: 2, name: "Tiburón Pantalón" },
          ]);
        }
        if (url.pathname.endsWith("projects:import-video")) {
          return ok({ project: { ...project, id: 9 }, job: { id: 5, type: "transcribe_video", status: "queued" } }, 201);
        }
        if (url.pathname === "/api/projects/9/render") {
          return ok({
            files: [{ kind: "final", name: "mi-reel.mp4", url: "/api/projects/9/render/files/mi-reel.mp4", width: 1080, height: 1920, duration_s: 42, updated_at: "2026-09-28T20:00:00", size_bytes: 1 }],
          });
        }
        if (url.pathname === "/api/projects/9/transcript") return ok({ text: "Nadie vio nada aquella noche." });
        if (url.pathname.endsWith("video:replace")) return ok({ project, job: null });
        return ok([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const wrap = (ui: React.ReactNode) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/proyectos"]}>
          <Routes>
            <Route path="/proyectos" element={ui} />
            <Route path="/proyectos/:id" element={<p>publicación abierta</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("importar: soltar el video, canal del selector, título del archivo y a Publicación", async () => {
    wrap(<ImportVideoDialog open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const video = new File([new Uint8Array(8)], "Caso Lima CapCut.mp4", { type: "video/mp4" });
    fireEvent.drop(within(dialog).getByTestId("import-drop"), { dataTransfer: { files: [video] } });
    expect((within(dialog).getByLabelText("Título del proyecto") as HTMLInputElement).value).toBe("Caso Lima CapCut");
    fireEvent.change(within(dialog).getByLabelText("De qué trata"), { target: { value: "Caso real de 1998." } });
    fireEvent.click(within(dialog).getByText("Importar y preparar publicación"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/channels/2/projects:import-video")).toBe(true));
    const form = calls.find((c) => c.path.endsWith("projects:import-video"))!.body as FormData;
    expect((form.get("file") as File).name).toBe("Caso Lima CapCut.mp4");
    expect([form.get("title"), form.get("notes"), form.get("transcribe")]).toEqual(["Caso Lima CapCut", "Caso real de 1998.", "true"]);
    expect(await screen.findByText("publicación abierta")).toBeTruthy();
  });

  it("no acepta archivos que no son video", async () => {
    wrap(<ImportVideoDialog open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.drop(within(dialog).getByTestId("import-drop"), { dataTransfer: { files: [new File(["x"], "nota.txt", { type: "text/plain" })] } });
    expect((within(dialog).getByText("Importar y preparar publicación").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("panel del proyecto importado: video, transcripción y reemplazar", async () => {
    wrap(<ImportedVideoPanel project={project} />);
    expect((await screen.findByTestId("transcript")).textContent).toBe("Nadie vio nada aquella noche.");
    expect(screen.getByText("render/mi-reel.mp4")).toBeTruthy();
    expect(screen.getByText("Transcribir de nuevo")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nueva versión del video"), {
      target: { files: [new File([new Uint8Array(4)], "v2.mp4", { type: "video/mp4" })] },
    });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/projects/9/video:replace")).toBe(true));
  });
});
