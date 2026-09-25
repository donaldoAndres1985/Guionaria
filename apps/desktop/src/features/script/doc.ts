import type { JSONContent } from "@tiptap/core";
import type { ScriptSegment, SegmentInput } from "@/lib/api";

const WORD_RE = /[\p{L}\p{N}_]+/gu;

/** Igual que en el núcleo: palabras = secuencias de letras/números. */
export function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

export function estimateSeconds(text: string, wordsPerSecond: number): number {
  return wordsPerSecond > 0 ? countWords(text) / wordsPerSecond : 0;
}

export interface SegmentAttrs {
  segKey: string | null;
  section: string | null;
  factCheck: boolean;
}

export function inputsToDoc(segments: SegmentInput[]): JSONContent {
  return {
    type: "doc",
    content: segments.length
      ? segments.map((s) => ({
          type: "segment",
          attrs: { segKey: s.seg_key, section: s.section, factCheck: s.needs_fact_check },
          content: s.text ? [{ type: "text", text: s.text }] : [],
        }))
      : [{ type: "segment", attrs: { segKey: null, section: null, factCheck: false } }],
  };
}

export function segmentsToDoc(segments: ScriptSegment[]): JSONContent {
  return inputsToDoc(toInputs(segments));
}

function nodeText(node: JSONContent): string {
  return (node.content ?? []).map((c) => c.text ?? "").join("");
}

/** Documento → lo que se guarda. Los párrafos vacíos se descartan. */
export function docToSegments(doc: JSONContent): SegmentInput[] {
  return (doc.content ?? [])
    .filter((n) => n.type === "segment")
    .map((n) => ({
      seg_key: (n.attrs?.segKey as string | null) ?? null,
      section: (n.attrs?.section as string | null) ?? null,
      text: nodeText(n).trim(),
      needs_fact_check: Boolean(n.attrs?.factCheck),
    }))
    .filter((s) => s.text.length > 0);
}

/** Compara lo editado con lo guardado para saber si hay cambios sin guardar. */
export function sameSegments(a: SegmentInput[], b: SegmentInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.seg_key === b[i].seg_key &&
      s.text === b[i].text &&
      (s.section ?? null) === (b[i].section ?? null) &&
      s.needs_fact_check === b[i].needs_fact_check,
  );
}

export function toInputs(segments: ScriptSegment[]): SegmentInput[] {
  return segments.map((s) => ({
    seg_key: s.seg_key,
    section: s.section,
    text: s.text,
    needs_fact_check: s.needs_fact_check,
  }));
}

/** Semáforo de duración: dentro de ±10 % verde, ±25 % ámbar, fuera rojo. */
export function durationTone(estimated: number, target: number | null): "ok" | "warn" | "bad" {
  if (!target) return "ok";
  const ratio = Math.abs(estimated - target) / target;
  if (ratio <= 0.1) return "ok";
  if (ratio <= 0.25) return "warn";
  return "bad";
}
