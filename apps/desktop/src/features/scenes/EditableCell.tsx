import { useState } from "react";
import { cn } from "@/lib/utils";

interface EditableCellProps {
  value: string | null;
  onCommit: (value: string | null) => void;
  editable: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
}

/**
 * Celda de texto que se edita con un clic. Enter guarda (Mayús+Enter salto de línea en las
 * de varias líneas), Esc cancela y al salir del campo se guarda. Vacío se guarda como null.
 */
export function EditableCell({
  value,
  onCommit,
  editable,
  multiline,
  placeholder = "—",
  className,
  label,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = () => {
    if (!editable) return;
    setDraft(value ?? "");
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== (value ?? null)) onCommit(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    } else if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      commit();
    }
  };

  const fieldClass =
    "w-full rounded border border-ring bg-background px-1.5 py-1 text-[13px] outline-none";

  if (editing) {
    return multiline ? (
      <textarea
        autoFocus
        aria-label={label}
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cn(fieldClass, "resize-none leading-snug")}
      />
    ) : (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={fieldClass}
      />
    );
  }

  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Editar ${label}` : undefined}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          start();
        }
      }}
      className={cn(
        "min-h-7 rounded px-1.5 py-1 text-[13px] leading-snug break-words whitespace-pre-wrap",
        editable && "cursor-text hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-ring/60",
        className,
      )}
    >
      {value || <span className="text-subtle">{editable ? placeholder : "—"}</span>}
    </div>
  );
}
