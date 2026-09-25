import { Editor } from "@tiptap/core";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptSegment } from "@/lib/api";
import { docToSegments, segmentsToDoc } from "./doc";
import { ScriptDocument, Segment } from "./segment-extension";

const seg = (key: string, text: string, section = "gancho", fact = false): ScriptSegment => ({
  seg_key: key,
  position: 0,
  section,
  text,
  est_duration_s: 0,
  needs_fact_check: fact,
});

let editor: Editor;

function makeEditor(segments: ScriptSegment[]) {
  editor = new Editor({
    extensions: [ScriptDocument, Text, Segment, UndoRedo],
    content: segmentsToDoc(segments),
  });
  return editor;
}

afterEach(() => editor?.destroy());

/** Posición de un texto dentro del documento (inicio del texto buscado). */
function posOf(text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = pos + i;
  });
  if (found < 0) throw new Error(`No se encontró "${text}"`);
  return found;
}

function keys() {
  const out: (string | null)[] = [];
  editor.state.doc.forEach((n) => out.push(n.attrs.segKey));
  return out;
}

function saved() {
  return docToSegments(editor.getJSON());
}

describe("reglas de IDs de segmento", () => {
  it("dividir con Enter: la primera parte conserva el ID", () => {
    makeEditor([seg("seg_001", "Esto no es una película."), seg("seg_002", "Pasó en 2008.")]);
    editor.commands.setTextSelection(posOf(" es una"));
    editor.commands.splitBlock();
    expect(keys()).toEqual(["seg_001", null, "seg_002"]);
    expect(saved().map((s) => s.text)).toEqual(["Esto no", "es una película.", "Pasó en 2008."]);
  });

  it("Enter al final crea un segmento vacío sin ID que hereda la sección", () => {
    makeEditor([seg("seg_001", "Hola.", "contexto")]);
    editor.commands.setTextSelection(posOf("Hola.") + "Hola.".length);
    editor.commands.splitBlock();
    editor.commands.insertContent("Nuevo.");
    const segs = saved();
    expect(segs.map((s) => [s.seg_key, s.section, s.text])).toEqual([
      ["seg_001", "contexto", "Hola."],
      [null, "contexto", "Nuevo."],
    ]);
  });

  it("Enter al inicio: el ID se queda con la parte que tiene el texto", () => {
    makeEditor([seg("seg_001", "Primero."), seg("seg_002", "Segundo.")]);
    editor.commands.setTextSelection(posOf("Segundo."));
    editor.commands.splitBlock();
    expect(keys()).toEqual(["seg_001", null, "seg_002"]);
    expect(saved().map((s) => s.seg_key)).toEqual(["seg_001", "seg_002"]);
  });

  it("unir con Retroceso: se conserva el ID del primero", () => {
    makeEditor([seg("seg_001", "Uno."), seg("seg_002", "Dos."), seg("seg_003", "Tres.")]);
    editor.commands.setTextSelection(posOf("Dos."));
    editor.commands.joinBackward();
    expect(keys()).toEqual(["seg_001", "seg_003"]);
    expect(saved()[0].text).toBe("Uno.Dos.");
  });

  it("unir con Suprimir al final: se conserva el ID del primero", () => {
    makeEditor([seg("seg_001", "Uno."), seg("seg_002", "Dos.")]);
    editor.commands.setTextSelection(posOf("Uno.") + 4);
    editor.commands.joinForward();
    expect(keys()).toEqual(["seg_001"]);
  });

  it("pegar varios párrafos: el contenido pegado no trae IDs", () => {
    makeEditor([seg("seg_001", "Inicio."), seg("seg_002", "Fin.")]);
    const pasted = editor.schema.nodeFromJSON(
      segmentsToDoc([seg("seg_001", "Copia A."), seg("seg_002", "Copia B.")]),
    );
    editor.commands.setTextSelection(posOf("Fin.") + 4);
    editor.commands.splitBlock();
    const view = editor.view;
    const slice = view.someProp("transformPasted", (f) => f(new Slice(pasted.content, 0, 0), view, false))!;
    view.dispatch(view.state.tr.replaceSelection(slice));
    const segs = saved();
    expect(segs.map((s) => s.seg_key)).toEqual(["seg_001", "seg_002", null, null]);
    expect(new Set(segs.filter((s) => s.seg_key).map((s) => s.seg_key)).size).toBe(2);
  });

  it("claves duplicadas por cualquier otra vía: solo la primera se conserva", () => {
    makeEditor([seg("seg_001", "A."), seg("seg_001", "B.")]);
    editor.commands.insertContentAt(1, "x"); // cualquier cambio dispara la normalización
    expect(keys()).toEqual(["seg_001", null]);
  });

  it("deshacer devuelve el ID original tras dividir", () => {
    makeEditor([seg("seg_001", "Esto no es.")]);
    editor.commands.setTextSelection(posOf(" es."));
    editor.commands.splitBlock();
    editor.commands.undo();
    expect(keys()).toEqual(["seg_001"]);
    expect(saved()[0].text).toBe("Esto no es.");
  });
});

describe("comandos de segmento", () => {
  it("marcar y desmarcar verificar dato en la selección", () => {
    makeEditor([seg("seg_001", "Uno."), seg("seg_002", "Dos."), seg("seg_003", "Tres.")]);
    const { state } = editor;
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, posOf("Uno."), posOf("Dos.") + 2)),
    );
    editor.commands.toggleFactCheck();
    expect(saved().map((s) => s.needs_fact_check)).toEqual([true, true, false]);
    editor.commands.toggleFactCheck();
    expect(saved().map((s) => s.needs_fact_check)).toEqual([false, false, false]);
  });

  it("cambiar la sección del segmento actual", () => {
    makeEditor([seg("seg_001", "Uno.", "gancho"), seg("seg_002", "Dos.", "gancho")]);
    editor.commands.setTextSelection(posOf("Dos."));
    editor.commands.setSection("cierre");
    expect(saved().map((s) => s.section)).toEqual(["gancho", "cierre"]);
  });
});

describe("etiquetas de sección", () => {
  it("solo el primer segmento de cada sección lleva etiqueta", () => {
    makeEditor([
      seg("seg_001", "A.", "gancho"),
      seg("seg_002", "B.", "gancho"),
      seg("seg_003", "C.", "contexto"),
    ]);
    const labels = [...editor.view.dom.querySelectorAll("[data-section-label]")].map((el) =>
      el.getAttribute("data-section-label"),
    );
    expect(labels).toEqual(["GANCHO", "CONTEXTO"]);
  });
});
