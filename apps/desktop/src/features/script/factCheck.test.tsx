import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Script } from "@/lib/api";
import { ScriptStage } from "./ScriptStage";
import type { ScriptGeneration } from "./useScriptGeneration";
import { useScriptEditor } from "./useScriptEditor";

const script = (): Script => ({
  project_id: 1,
  version: 1,
  status: "draft",
  source: "claude",
  created_at: "2026-09-26T10:00:00+00:00",
  segments: [
    { seg_key: "seg_001", position: 1, section: "gancho", text: "Uno.", est_duration_s: 1, needs_fact_check: true },
    { seg_key: "seg_002", position: 2, section: "gancho", text: "Dos.", est_duration_s: 1, needs_fact_check: true },
    { seg_key: "seg_003", position: 3, section: "gancho", text: "Tres.", est_duration_s: 1, needs_fact_check: false },
  ],
  word_count: 3,
  total_est_s: 3,
  target_duration_s: 60,
  words_per_second: 2,
  sections: ["gancho"],
});

const project = (status: Project["status"]): Project => ({
  id: 1,
  channel_id: 1,
  channel_name: "Casos Reales",
  channel_slug: "casos-reales",
  title: "El caso",
  slug: "el-caso",
  format: "reel",
  status,
  topic: null,
  research_notes: null,
  target_duration_s: 60,
  target_publish_at: null,
  priority: 2,
  tags: [],
  folder_path: "",
  parent_project_id: null,
  created_at: "",
  updated_at: "",
});

const generation: ScriptGeneration = {
  job: undefined as unknown as ScriptGeneration["job"],
  generating: false,
  error: null,
  start: () => {},
  dismissError: () => {},
};

let ctl: ReturnType<typeof useScriptEditor>;

function Harness({ p }: { p: Project }) {
  ctl = useScriptEditor(p);
  return <ScriptStage project={p} ctl={ctl} generation={generation} />;
}

describe("datos por verificar en el guion", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/projects/1/script") return new Response(JSON.stringify(script()));
        if (path === "/api/channels") return new Response("[]");
        return new Response("[]");
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function mount(status: Project["status"] = "GUION_BORRADOR") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness p={project(status)} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(ctl.editor?.getText()).toContain("Uno."));
  }

  it("explica qué significa la marca y cuántos segmentos la tienen", async () => {
    await mount();
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("2 segmentos con datos por verificar.");
    expect(note.textContent).toContain("no los encontró en el tema ni en las notas");
  });

  it("un clic en ⚠ quita la marca del segmento", async () => {
    await mount();
    const flags = await screen.findAllByLabelText("Marcar dato como comprobado");
    expect(flags).toHaveLength(2);
    fireEvent.click(flags[0]);
    await waitFor(() => expect(ctl.factChecks).toBe(1));
    expect(ctl.dirty).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("1 segmento con un dato por verificar.");
  });

  it("«Quitar todas» limpia todas las marcas y el aviso desaparece", async () => {
    await mount();
    fireEvent.click(await screen.findByText("Quitar todas"));
    await waitFor(() => expect(ctl.factChecks).toBe(0));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("con el guion aprobado solo informa y se puede ocultar", async () => {
    await mount("GUION_APROBADO");
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("Desbloquea el guion para quitar las marcas.");
    expect(screen.queryByText("Quitar todas")).toBeNull();
    expect(screen.queryByLabelText("Marcar dato como comprobado")).toBeNull();
    fireEvent.click(screen.getByLabelText("Ocultar aviso"));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
