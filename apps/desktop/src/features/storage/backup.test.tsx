import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCover, MediaStrip } from "@/components/projects/ProjectThumbs";
import { BackupSettings } from "@/features/settings/BackupSettings";
import type { AppSettings, BackupStatus, StorageNode, StorageUsage } from "@/lib/api";
import { FullCleanupDialog } from "./FullCleanupDialog";

const MB = 1024 * 1024;
const part = (id: string, name: string, bytes: number): StorageNode => ({
  id,
  name,
  kind: "part",
  bytes,
  files: 2,
  project_id: null,
  channel_id: null,
  children: [],
});
const USAGE: StorageUsage = {
  home: "C:\\Guionaria",
  shared_bytes: 0,
  disk_total: 500 * 1024 * MB,
  disk_free: 100 * 1024 * MB,
  tree: {
    id: "root",
    name: "Guionaria",
    kind: "root",
    bytes: 300 * MB,
    files: 2,
    project_id: null,
    channel_id: null,
    children: [
      {
        id: "c1",
        name: "Versículos",
        kind: "channel",
        bytes: 300 * MB,
        files: 2,
        project_id: null,
        channel_id: 1,
        children: [
          {
            id: "p4",
            name: "25 minutos de paz",
            kind: "project",
            bytes: 300 * MB,
            files: 2,
            project_id: 4,
            channel_id: 1,
            children: [part("p4:render", "Render", 300 * MB)],
          },
        ],
      },
    ],
  },
};

const READY: BackupStatus = { folder: "G:\\Mi unidad\\Guionaria", ok: true, detail: null, free_bytes: 50 * 1024 * MB, suggestions: [] };

describe("copia de seguridad", () => {
  let posts: { path: string; body: unknown }[];
  let backup: BackupStatus;

  beforeEach(() => {
    posts = [];
    backup = READY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const ok = (d: unknown) => new Response(JSON.stringify(d));
        if (init?.method === "POST") {
          posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
          if (url.pathname === "/api/storage/backup") {
            return ok({ folder: READY.folder, items: [], copied: 2, bytes: 300 * MB });
          }
          return ok({ deleted: 2, freed_bytes: 300 * MB });
        }
        if (url.pathname === "/api/storage/backup") {
          const folder = url.searchParams.get("folder");
          if (folder === null) return ok(backup);
          return ok(
            folder.startsWith("G:")
              ? { ...READY, folder }
              : { folder, ok: false, detail: "No se encuentra X:\\: ¿está conectada la unidad o abierto Google Drive?", free_bytes: null, suggestions: [{ label: "Google Drive", path: "G:\\Mi unidad\\Guionaria" }] },
          );
        }
        if (url.pathname === "/api/settings") return ok({ backup: { folder: READY.folder, before_cleanup: true } });
        return ok({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderDialog() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <FullCleanupDialog open usage={USAGE} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("limpieza completa: copia el video y la portada antes de borrar el render", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Render"));
    fireEvent.click(within(dialog).getByLabelText("25 minutos de paz"));
    const check = (await within(dialog).findByLabelText(
      "Copiar el video final y la portada a la copia de seguridad",
    )) as HTMLInputElement;
    await waitFor(() => expect(check.checked).toBe(true)); // viene marcada desde Ajustes
    expect(within(dialog).getByText("G:\\Mi unidad\\Guionaria")).toBeTruthy();
    fireEvent.click(within(dialog).getByText(/^Copiar y borrar/));
    await waitFor(() =>
      expect(posts).toEqual([{ path: "/api/storage/cleanup/media", body: { project_ids: [4], parts: ["render"], backup: true } }]),
    );
  });

  it("limpieza completa: se puede solo copiar, o borrar sin copiar", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Render"));
    fireEvent.click(within(dialog).getByLabelText("25 minutos de paz"));
    fireEvent.click(await within(dialog).findByText("Solo copiar"));
    await waitFor(() => expect(posts).toEqual([{ path: "/api/storage/backup", body: { project_ids: [4] } }]));

    fireEvent.click(within(dialog).getByLabelText("Copiar el video final y la portada a la copia de seguridad"));
    fireEvent.click(within(dialog).getByText(/^Borrar 2 archivos/));
    await waitFor(() =>
      expect(posts[1]).toEqual({ path: "/api/storage/cleanup/media", body: { project_ids: [4], parts: ["render"], backup: false } }),
    );
  });

  it("limpieza completa: sin carpeta de respaldo invita a configurarla", async () => {
    backup = { folder: "", ok: false, detail: null, free_bytes: null, suggestions: [] };
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Render"));
    expect(await within(dialog).findByText(/Configura una carpeta de copia de seguridad/)).toBeTruthy();
    expect(within(dialog).queryByText("Solo copiar")).toBeNull();
  });

  it("ajustes: prueba la carpeta escrita y propone Google Drive", async () => {
    function Harness() {
      const [settings, setSettings] = useState({ backup: { folder: "X:\\Respaldo", before_cleanup: true } } as AppSettings);
      return <BackupSettings settings={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/¿está conectada la unidad/)).toBeTruthy();
    fireEvent.click(screen.getByText("Google Drive"));
    expect((screen.getByLabelText("Carpeta de respaldo") as HTMLInputElement).value).toBe("G:\\Mi unidad\\Guionaria");
    expect(await screen.findByText(/Lista para guardar copias/, {}, { timeout: 3000 })).toBeTruthy();
  });
});

describe("portada del proyecto", () => {
  afterEach(cleanup);

  it("si la imagen no carga prueba la siguiente y al final muestra el ícono", () => {
    render(
      <ProjectCover
        project={{ format: "reel", title: "Caso", cover_url: "/api/projects/3/cover", media_thumbs: ["/api/assets/29/thumb"] }}
      />,
    );
    const first = document.querySelector("img")!;
    expect(first.getAttribute("src")).toContain("/api/projects/3/cover");
    fireEvent.error(first);
    const second = document.querySelector("img")!;
    expect(second.getAttribute("src")).toContain("/api/assets/29/thumb");
    fireEvent.error(second);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Sin portada")).toBeTruthy();
  });

  it("la tira de medios cambia las miniaturas rotas por un ícono", () => {
    render(<MediaStrip project={{ media_thumbs: ["/api/assets/1/thumb", "/api/assets/2/thumb"], media_count: 2 }} />);
    fireEvent.error(document.querySelectorAll("img")[0]);
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });
});
