import { describe, expect, it } from "vitest";
import type { ScriptSegment } from "@/lib/api";
import {
  countWords,
  docToSegments,
  durationTone,
  estimateSeconds,
  sameSegments,
  segmentsToDoc,
  toInputs,
} from "./doc";

const segments: ScriptSegment[] = [
  { seg_key: "seg_001", position: 1, section: "gancho", text: "Hola, mundo.", est_duration_s: 1, needs_fact_check: false },
  { seg_key: "seg_002", position: 2, section: null, text: "Año 2008.", est_duration_s: 1, needs_fact_check: true },
];

describe("conversión documento ↔ segmentos", () => {
  it("ida y vuelta conserva claves, secciones, texto y marcas", () => {
    expect(docToSegments(segmentsToDoc(segments))).toEqual(toInputs(segments));
  });

  it("guion vacío produce un segmento vacío editable, que no se guarda", () => {
    const doc = segmentsToDoc([]);
    expect(doc.content).toHaveLength(1);
    expect(docToSegments(doc)).toEqual([]);
  });

  it("descarta párrafos vacíos y recorta espacios", () => {
    const doc = segmentsToDoc(segments);
    doc.content!.push({ type: "segment", attrs: { segKey: null }, content: [{ type: "text", text: "   " }] });
    doc.content![0].content = [{ type: "text", text: "  Hola, mundo.  " }];
    expect(docToSegments(doc).map((s) => s.text)).toEqual(["Hola, mundo.", "Año 2008."]);
  });

  it("detecta cambios sin guardar", () => {
    const base = toInputs(segments);
    expect(sameSegments(base, toInputs(segments))).toBe(true);
    expect(sameSegments(base, [{ ...base[0], text: "Otro." }, base[1]])).toBe(false);
    expect(sameSegments(base, [{ ...base[0], needs_fact_check: true }, base[1]])).toBe(false);
    expect(sameSegments(base, base.slice(0, 1))).toBe(false);
  });
});

describe("duración", () => {
  it("cuenta palabras como el núcleo (letras con tilde y números)", () => {
    expect(countWords("Esto no es una película.")).toBe(5);
    expect(countWords("El 12 de septiembre, año 2008")).toBe(6);
    expect(countWords("   ")).toBe(0);
  });

  it("estima segundos con las palabras por segundo del canal", () => {
    expect(estimateSeconds("uno dos tres cuatro cinco", 2.5)).toBe(2);
    expect(estimateSeconds("uno", 0)).toBe(0);
  });

  it("semáforo contra la duración objetivo", () => {
    expect(durationTone(58, 60)).toBe("ok");
    expect(durationTone(50, 60)).toBe("warn");
    expect(durationTone(30, 60)).toBe("bad");
    expect(durationTone(30, null)).toBe("ok");
  });
});
