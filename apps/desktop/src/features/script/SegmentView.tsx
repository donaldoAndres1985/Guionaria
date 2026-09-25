import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { estimateSeconds } from "./doc";
import { Segment } from "./segment-extension";

type SegmentStorage = { segment: { wordsPerSecond: number } };

function SegmentView({ node, editor, decorations }: NodeViewProps) {
  const wps = (editor.storage as unknown as SegmentStorage).segment.wordsPerSecond;
  const seconds = estimateSeconds(node.textContent, wps);
  const sectionLabel = decorations
    .map((d) => (d.spec as { sectionLabel?: string }).sectionLabel)
    .find(Boolean);

  return (
    <NodeViewWrapper className="seg" data-fact={node.attrs.factCheck ? "true" : undefined}>
      {sectionLabel && (
        <span className="seg-section" contentEditable={false}>
          {sectionLabel}
        </span>
      )}
      <span className="seg-gutter" contentEditable={false}>
        {node.textContent.trim() ? `${seconds.toFixed(1)}s` : ""}
      </span>
      <NodeViewContent className="seg-text" />
      <span className="seg-flag" contentEditable={false}>
        {node.attrs.factCheck && (
          <span title="Verificar dato: no está en las notas de investigación">
            <TriangleAlert className="size-3.5" />
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}

/** Segmento con su vista React. Las palabras por segundo se ajustan según el canal. */
export const SegmentWithView = Segment.extend({
  addStorage() {
    return { wordsPerSecond: 2.5 };
  },
  addNodeView() {
    return ReactNodeViewRenderer(SegmentView);
  },
});
