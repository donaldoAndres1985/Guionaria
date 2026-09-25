import { type CommandProps, mergeAttributes, Node } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** El documento del guion es una lista de segmentos (nada más). */
export const ScriptDocument = Document.extend({ content: "segment+" });

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    segment: {
      /** Marca/desmarca "verificar dato" en los segmentos de la selección. */
      toggleFactCheck: () => ReturnType;
      /** Fija "verificar dato" en los segmentos de la selección. */
      setFactCheck: (value: boolean) => ReturnType;
      /** Cambia la sección de los segmentos de la selección. */
      setSection: (section: string) => ReturnType;
    };
  }
}

export const segmentIdsKey = new PluginKey("segment-ids");
const sectionLabelsKey = new PluginKey("segment-section-labels");

/**
 * Reglas de IDs de segmento (vinculan cada segmento con sus escenas):
 * - Dividir (Enter): la parte con texto original conserva el ID; la otra queda sin ID.
 * - Unir (Retroceso/Suprimir): se conserva el ID del primero (comportamiento de ProseMirror).
 * - Pegar: el contenido pegado nunca trae IDs.
 * - Un segmento nuevo hereda la sección del anterior.
 * Los segmentos sin ID reciben uno nuevo del núcleo al guardar.
 */
export function normalizeSegments(doc: PMNode, tr: Transaction): boolean {
  const firstIndexByKey = new Map<string, number>();
  const nodes: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => nodes.push({ node, pos }));

  const patches = new Map<number, Record<string, unknown>>();
  const attrsAt = (i: number) => ({ ...nodes[i].node.attrs, ...patches.get(i) });

  nodes.forEach(({ node }, i) => {
    const key = node.attrs.segKey as string | null;
    if (key) {
      const first = firstIndexByKey.get(key);
      if (first === undefined) {
        firstIndexByKey.set(key, i);
      } else if (nodes[first].node.textContent.trim() === "" && node.textContent.trim() !== "") {
        // Enter al inicio de un segmento: el ID se queda con la parte que tiene el texto.
        patches.set(first, { ...patches.get(first), segKey: null });
        firstIndexByKey.set(key, i);
      } else {
        patches.set(i, { ...patches.get(i), segKey: null });
      }
    }
    if (!node.attrs.section && i > 0) {
      const inherited = attrsAt(i - 1).section;
      if (inherited) patches.set(i, { ...patches.get(i), section: inherited });
    }
  });

  patches.forEach((patch, i) => {
    tr.setNodeMarkup(tr.mapping.map(nodes[i].pos), undefined, { ...nodes[i].node.attrs, ...patch });
  });
  return patches.size > 0;
}

function stripKeys(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    nodes.push(
      node.type.name === "segment"
        ? node.type.create({ ...node.attrs, segKey: null }, node.content, node.marks)
        : node,
    );
  });
  return Fragment.from(nodes);
}

/** Etiqueta de sección (GANCHO, CONTEXTO…) sobre el primer segmento de cada sección. */
function sectionDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  let previous: string | null = null;
  doc.forEach((node, pos) => {
    const section = (node.attrs.section as string | null) ?? null;
    if (section && section !== previous) {
      const label = section.toUpperCase();
      // El atributo sirve al HTML plano; `spec.sectionLabel` lo lee la vista React del segmento.
      decorations.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          { "data-section-label": label },
          { sectionLabel: label },
        ),
      );
    }
    previous = section;
  });
  return DecorationSet.create(doc, decorations);
}

export const Segment = Node.create({
  name: "segment",
  group: "block",
  content: "text*",
  defining: true,

  addAttributes() {
    return {
      segKey: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-seg-key"),
        renderHTML: (attrs) => (attrs.segKey ? { "data-seg-key": attrs.segKey } : {}),
      },
      section: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-section"),
        renderHTML: (attrs) => (attrs.section ? { "data-section": attrs.section } : {}),
      },
      factCheck: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-fact-check") === "true",
        renderHTML: (attrs) => (attrs.factCheck ? { "data-fact-check": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes({ "data-segment": "" }, HTMLAttributes), 0];
  },

  addCommands() {
    const forSelection =
      (patch: (attrs: Record<string, unknown>) => Record<string, unknown>) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== "segment") return true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch(node.attrs) });
          return false;
        });
        if (dispatch) dispatch(tr);
        return true;
      };
    return {
      toggleFactCheck: () => (props) => {
        const { from } = props.state.selection;
        const current = props.state.doc.resolve(from).parent.attrs.factCheck as boolean;
        return forSelection(() => ({ factCheck: !current }))(props);
      },
      setFactCheck: (value: boolean) => (props) => forSelection(() => ({ factCheck: value }))(props),
      setSection: (section: string) => (props) => forSelection(() => ({ section }))(props),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: segmentIdsKey,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          return normalizeSegments(state.doc, tr) ? tr : null;
        },
        props: {
          transformPasted(slice) {
            return new Slice(stripKeys(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
      new Plugin({
        key: sectionLabelsKey,
        state: {
          init: (_config, state) => sectionDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? sectionDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return sectionLabelsKey.getState(state);
          },
        },
      }),
    ];
  },
});
