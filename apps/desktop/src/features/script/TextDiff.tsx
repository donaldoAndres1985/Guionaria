import { diffWords } from "diff";

/** Diferencias palabra por palabra: agregado en verde, quitado en rojo tachado. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="selectable text-[14px] leading-relaxed whitespace-pre-wrap">
      {diffWords(before, after).map((part, i) =>
        part.added ? (
          <ins key={i} className="rounded-sm bg-success px-0.5 text-success-foreground no-underline">
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={i} className="rounded-sm bg-danger/15 px-0.5 text-danger">
            {part.value}
          </del>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}
