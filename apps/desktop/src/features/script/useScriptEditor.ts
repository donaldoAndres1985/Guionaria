import { Text } from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { type Editor, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChannels } from "@/hooks/useChannels";
import {
  useApproveScript,
  useRewrite,
  useSaveScript,
  useScript,
  useUnlockScript,
} from "@/hooks/useScript";
import type { Project, RewriteResult, Script, SegmentInput } from "@/lib/api";
import {
  docToSegments,
  estimateSeconds,
  inputsToDoc,
  sameSegments,
  segmentsToDoc,
  toInputs,
} from "./doc";
import { ScriptDocument } from "./segment-extension";
import { SegmentWithView } from "./SegmentView";

type SegmentStorage = { segment: { wordsPerSecond: number } };

const EDITABLE_STATUSES = ["IDEA", "GUION_BORRADOR"];

export interface PendingRewrite {
  segKey: string;
  fragment: string;
  /** Rango del documento que se reemplaza al aceptar. */
  range: { from: number; to: number };
  result?: RewriteResult;
}

/** Tras guardar, el núcleo asigna claves a los segmentos nuevos: se copian al documento
 * sin tocar el historial de deshacer ni mover el cursor. */
function applySavedKeys(editor: Editor, script: Script) {
  const { state } = editor;
  const tr = state.tr;
  let i = 0;
  state.doc.forEach((node, pos) => {
    if (!node.textContent.trim()) return;
    const saved = script.segments[i++];
    if (!saved) return;
    if (node.attrs.segKey !== saved.seg_key || node.attrs.section !== saved.section) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        segKey: saved.seg_key,
        section: saved.section,
      });
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

/** Ajusta el rango para no incluir espacios al borde (el núcleo recorta el fragmento). */
function trimRange(text: string, from: number) {
  const start = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return { fragment: trimmed, range: { from: from + start, to: from + start + trimmed.length } };
}

export function useScriptEditor(project: Project) {
  const { data: script, isPending } = useScript(project.id);
  const { data: channels = [] } = useChannels();
  const wps =
    script?.words_per_second ??
    channels.find((c) => c.id === project.channel_id)?.words_per_second ??
    2.5;

  const saveMutation = useSaveScript(project.id);
  const approveMutation = useApproveScript(project.id);
  const unlockMutation = useUnlockScript(project.id);
  const rewriteMutation = useRewrite(project.id);

  const locked = !EDITABLE_STATUSES.includes(project.status);
  const [pending, setPending] = useState<PendingRewrite | null>(null);
  const [lastSaved, setLastSaved] = useState<SegmentInput[]>([]);
  const [current, setCurrent] = useState<SegmentInput[]>([]);
  const loadedVersion = useRef<number | null>(null);

  const editor = useEditor(
    {
      extensions: [
        ScriptDocument,
        Text,
        SegmentWithView,
        UndoRedo,
        Placeholder.configure({ placeholder: "Escribe el guion aquí o genéralo con Claude…" }),
      ],
      content: segmentsToDoc([]),
      editorProps: { attributes: { class: "script-editor", spellcheck: "true", lang: "es" } },
      onUpdate: ({ editor }) => setCurrent(docToSegments(editor.getJSON())),
    },
    [project.id],
  );

  // Carga el guion del núcleo (primera vez, regeneración o restauración) si no hay cambios locales.
  useEffect(() => {
    if (!editor || script === undefined) return;
    const version = script?.version ?? 0;
    if (loadedVersion.current === version) return;
    const local = docToSegments(editor.getJSON());
    if (loadedVersion.current !== null && !sameSegments(local, lastSaved)) return;
    const saved = script ? toInputs(script.segments) : [];
    loadedVersion.current = version;
    // En una microtarea: las vistas React de los segmentos no pueden montarse durante un render.
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(segmentsToDoc(script?.segments ?? []), { emitUpdate: false });
      setLastSaved(saved);
      setCurrent(saved);
    });
  }, [editor, script, lastSaved]);

  useEffect(() => {
    editor?.setEditable(!locked && !pending);
  }, [editor, locked, pending]);

  useEffect(() => {
    if (editor) (editor.storage as unknown as SegmentStorage).segment.wordsPerSecond = wps;
  }, [editor, wps]);

  const dirty = !sameSegments(current, lastSaved);
  const estimated = current.reduce((sum, s) => sum + estimateSeconds(s.text, wps), 0);
  const factChecks = current.filter((s) => s.needs_fact_check).length;

  async function save(): Promise<Script | null> {
    if (!editor) return null;
    const segments = docToSegments(editor.getJSON());
    if (!segments.length) {
      toast.error("El guion está vacío");
      return null;
    }
    const saved = await saveMutation.mutateAsync(segments);
    applySavedKeys(editor, saved);
    loadedVersion.current = saved.version;
    const inputs = toInputs(saved.segments);
    setLastSaved(inputs);
    setCurrent(docToSegments(editor.getJSON()));
    return saved;
  }

  async function approve() {
    if (dirty && !(await save())) return;
    await approveMutation.mutateAsync();
    toast.success("Guion aprobado");
  }

  async function unlock() {
    const { scenes_to_review } = await unlockMutation.mutateAsync();
    toast.success(
      scenes_to_review
        ? `Guion desbloqueado. Si cambias un segmento, sus escenas quedarán para revisar.`
        : "Guion desbloqueado",
    );
  }

  function discard() {
    if (!editor) return;
    editor.commands.setContent(inputsToDoc(lastSaved), { emitUpdate: false });
    setCurrent(lastSaved);
  }

  /** Abre la reescritura para la selección (o el segmento del cursor). Guarda antes si hace falta. */
  async function startRewrite(): Promise<PendingRewrite | null> {
    if (!editor) return null;
    const { $from, $to } = editor.state.selection;
    if ($from.parent !== $to.parent) {
      toast.error("Selecciona texto dentro de un solo segmento");
      return null;
    }
    if (!$from.parent.textContent.trim()) {
      toast.error("El segmento está vacío");
      return null;
    }
    if (dirty || !$from.parent.attrs.segKey) {
      if (!(await save())) return null;
    }
    const sel = editor.state.selection;
    const node = sel.$from.parent;
    const from = sel.empty ? sel.$from.start() : sel.from;
    const to = sel.empty ? sel.$from.end() : sel.to;
    const { fragment, range } = trimRange(editor.state.doc.textBetween(from, to), from);
    const next: PendingRewrite = { segKey: node.attrs.segKey as string, fragment, range };
    setPending(next);
    return next;
  }

  /** `target` permite pedir la reescritura justo después de startRewrite (antes de re-render). */
  async function requestRewrite(instruction: string, target: PendingRewrite | null = pending) {
    if (!target) return;
    const result = await rewriteMutation.mutateAsync({
      segKey: target.segKey,
      instruccion: instruction,
      fragmento: target.fragment,
    });
    setPending({ ...target, result });
  }

  function acceptRewrite() {
    if (!editor || !pending?.result) return;
    const { result, range } = pending;
    setPending(null);
    editor.setEditable(true);
    editor.chain().focus().insertContentAt(range, result.texto).run();
    if (result.verificar_dato) {
      editor.chain().setTextSelection(range.from).setFactCheck(true).run();
    }
  }

  function cancelRewrite() {
    setPending(null);
  }

  return {
    editor,
    script,
    isPending,
    locked,
    dirty,
    estimated,
    factChecks,
    wps,
    saving: saveMutation.isPending,
    approving: approveMutation.isPending,
    unlocking: unlockMutation.isPending,
    save,
    approve,
    unlock,
    discard,
    pending,
    rewriting: rewriteMutation.isPending,
    startRewrite,
    requestRewrite,
    acceptRewrite,
    cancelRewrite,
  };
}

export type ScriptEditorController = ReturnType<typeof useScriptEditor>;
