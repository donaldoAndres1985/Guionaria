import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Script, ScriptSegment, SegmentInput } from "@/lib/api";
import { type ScriptEditorController, useScriptEditor } from "./useScriptEditor";

// --- Núcleo simulado ---------------------------------------------------------------

const seg = (key: string, text: string, section = "gancho", fact = false): ScriptSegment => ({
  seg_key: key,
  position: 0,
  section,
  text,
  est_duration_s: 0,
  needs_fact_check: fact,
});

function makeScript(version: number, segments: ScriptSegment[]): Script {
  return {
    project_id: 1,
    version,
    status: "draft",
    source: "claude",
    created_at: "2026-09-25T10:00:00+00:00",
    segments: segments.map((s, i) => ({ ...s, position: i + 1 })),
    word_count: 0,
    total_est_s: 0,
    target_duration_s: 60,
    words_per_second: 2,
    sections: ["gancho", "contexto"],
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];
let script: Script;
let rewriteResponse: { texto: string; verificar_dato: boolean };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path: url.pathname, body });

  if (url.pathname === "/api/channels") return json([]);
  if (url.pathname === "/api/projects/1/script" && method === "GET") return json(script);
  if (url.pathname === "/api/projects/1/script" && method === "PUT") {
    // Como el núcleo: conserva claves conocidas y asigna nuevas a las vacías.
    let next = 100;
    const segments = (body.segments as SegmentInput[]).map((s) =>
      seg(s.seg_key ?? `seg_${next++}`, s.text, s.section ?? "gancho", s.needs_fact_check),
    );
    script = makeScript(script.version + 1, segments);
    return json(script);
  }
  if (url.pathname === "/api/projects/1/script:approve") {
    script = { ...script, status: "approved" };
    return json(script);
  }
  if (url.pathname.endsWith(":rewrite")) {
    return json({
      seg_key: url.pathname.split("/").at(-1)!.replace(":rewrite", ""),
      fragmento: body.fragmento,
      ...rewriteResponse,
    });
  }
  return json({ detail: "no simulado" }, 404);
}

// --- Arnés -------------------------------------------------------------------------

const project = (status: Project["status"] = "GUION_BORRADOR"): Project => ({
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

let ctl: ScriptEditorController;

function Harness({ p }: { p: Project }) {
  ctl = useScriptEditor(p);
  return <EditorContent editor={ctl.editor} />;
}

async function mount(p = project()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness p={p} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ctl.script).toBeTruthy());
  await waitFor(() => expect(ctl.editor?.getText()).toContain("Uno."));
}

function posOf(text: string): number {
  let found = -1;
  ctl.editor!.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text);
  });
  return found;
}

function select(from: number, to: number) {
  const { state, view } = ctl.editor!;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

beforeEach(() => {
  calls = [];
  script = makeScript(1, [seg("seg_001", "Uno."), seg("seg_002", "Pasó en el año dos mil ocho.", "contexto")]);
  rewriteResponse = { texto: "Ocurrió en 2008", verificar_dato: true };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// --- Flujos ------------------------------------------------------------------------

describe("editor de guion: flujos", () => {
  it("carga el guion guardado sin cambios pendientes", async () => {
    await mount();
    expect(ctl.dirty).toBe(false);
    expect(ctl.locked).toBe(false);
    expect(ctl.editor!.isEditable).toBe(true);
    // 1 + 7 palabras a 2 palabras/s
    expect(ctl.estimated).toBeCloseTo(4);
  });

  it("editar marca cambios y guardar envía los segmentos y aplica las claves nuevas", async () => {
    await mount();
    act(() => {
      ctl.editor!.commands.setTextSelection(posOf("Uno.") + 4);
      ctl.editor!.commands.splitBlock();
      ctl.editor!.commands.insertContent("Nuevo segmento.");
    });
    await waitFor(() => expect(ctl.dirty).toBe(true));

    await act(() => ctl.save());
    const put = calls.find((c) => c.method === "PUT")!;
    expect((put.body as { segments: SegmentInput[] }).segments).toEqual([
      { seg_key: "seg_001", section: "gancho", text: "Uno.", needs_fact_check: false },
      { seg_key: null, section: "gancho", text: "Nuevo segmento.", needs_fact_check: false },
      { seg_key: "seg_002", section: "contexto", text: "Pasó en el año dos mil ocho.", needs_fact_check: false },
    ]);
    const keys: string[] = [];
    ctl.editor!.state.doc.forEach((n) => keys.push(n.attrs.segKey));
    expect(keys).toEqual(["seg_001", "seg_100", "seg_002"]);
    expect(ctl.dirty).toBe(false);
    expect(ctl.script!.version).toBe(2);
  });

  it("aprobar con cambios sin guardar guarda primero y luego aprueba", async () => {
    await mount();
    act(() => {
      ctl.editor!.commands.setTextSelection(posOf("Uno.") + 4);
      ctl.editor!.commands.insertContent(" Editado.");
    });
    await waitFor(() => expect(ctl.dirty).toBe(true));
    await act(() => ctl.approve());
    const order = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual(["PUT /api/projects/1/script", "POST /api/projects/1/script:approve"]);
  });

  it("reescribir un fragmento: pide a Claude, muestra la propuesta y al aceptar la aplica", async () => {
    await mount();
    const from = posOf("el año dos mil ocho");
    act(() => select(from, from + "el año dos mil ocho".length));

    let pending = null as Awaited<ReturnType<typeof ctl.startRewrite>>;
    await act(async () => {
      pending = await ctl.startRewrite();
    });
    expect(pending).toMatchObject({ segKey: "seg_002", fragment: "el año dos mil ocho" });
    expect(calls.some((c) => c.method === "PUT")).toBe(false); // sin cambios: no guarda
    await waitFor(() => expect(ctl.editor!.isEditable).toBe(false)); // bloqueado mientras decide

    await act(() => ctl.requestRewrite("usa la fecha en números", pending));
    const post = calls.find((c) => c.path.endsWith(":rewrite"))!;
    expect(post.path).toBe("/api/projects/1/script/segments/seg_002:rewrite");
    expect(post.body).toEqual({ instruccion: "usa la fecha en números", fragmento: "el año dos mil ocho" });
    expect(ctl.pending?.result?.texto).toBe("Ocurrió en 2008");

    act(() => ctl.acceptRewrite());
    await waitFor(() => expect(ctl.pending).toBeNull());
    const second = ctl.editor!.state.doc.child(1);
    expect(second.textContent).toBe("Pasó en Ocurrió en 2008.");
    expect(second.attrs.factCheck).toBe(true);
    expect(second.attrs.segKey).toBe("seg_002");
    await waitFor(() => expect(ctl.dirty).toBe(true));
    expect(ctl.editor!.isEditable).toBe(true);
  });

  it("reescribir sin selección usa el segmento completo", async () => {
    await mount();
    act(() => ctl.editor!.commands.setTextSelection(posOf("Uno.") + 1));
    let pending = null as Awaited<ReturnType<typeof ctl.startRewrite>>;
    await act(async () => {
      pending = await ctl.startRewrite();
    });
    expect(pending?.fragment).toBe("Uno.");
    act(() => ctl.cancelRewrite());
    await waitFor(() => expect(ctl.editor!.isEditable).toBe(true));
  });

  it("reescribir un segmento nuevo lo guarda antes para que tenga clave", async () => {
    await mount();
    act(() => {
      ctl.editor!.commands.setTextSelection(posOf("Uno.") + 4);
      ctl.editor!.commands.splitBlock();
      ctl.editor!.commands.insertContent("Segmento sin clave.");
    });
    let pending = null as Awaited<ReturnType<typeof ctl.startRewrite>>;
    await act(async () => {
      pending = await ctl.startRewrite();
    });
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    expect(pending?.segKey).toBe("seg_100");
  });

  it("no permite reescribir una selección que abarca varios segmentos", async () => {
    await mount();
    act(() => select(posOf("Uno."), posOf("Pasó") + 2));
    let pending = null as Awaited<ReturnType<typeof ctl.startRewrite>>;
    await act(async () => {
      pending = await ctl.startRewrite();
    });
    expect(pending).toBeNull();
    expect(calls.some((c) => c.path.endsWith(":rewrite"))).toBe(false);
  });

  it("descartar vuelve a lo guardado", async () => {
    await mount();
    act(() => {
      ctl.editor!.commands.setTextSelection(posOf("Uno.") + 4);
      ctl.editor!.commands.insertContent(" Basura.");
    });
    await waitFor(() => expect(ctl.dirty).toBe(true));
    act(() => ctl.discard());
    expect(ctl.dirty).toBe(false);
    expect(ctl.editor!.getText()).not.toContain("Basura");
  });

  it("guardar un guion vacío no llama al núcleo", async () => {
    await mount();
    act(() => {
      ctl.editor!.commands.selectAll();
      ctl.editor!.commands.deleteSelection();
    });
    const result = await act(() => ctl.save());
    expect(result).toBeNull();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("con el guion aprobado el editor queda de solo lectura", async () => {
    await mount(project("GUION_APROBADO"));
    expect(ctl.locked).toBe(true);
    await waitFor(() => expect(ctl.editor!.isEditable).toBe(false));
  });
});
