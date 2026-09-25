import type { ProjectFormat, ProjectStatus } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/project";
import { cn } from "@/lib/utils";

const STATUS_TONE: Partial<Record<ProjectStatus, string>> = {
  IDEA: "bg-panel-2 text-muted-foreground",
  PUBLICADO: "bg-success text-success-foreground",
  PROGRAMADO: "bg-success text-success-foreground",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
        STATUS_TONE[status] ?? "bg-active text-active-foreground",
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Rectángulo con la proporción real del formato: horizontal (16:9) o vertical (9:16). */
export function FormatBadge({ format }: { format: ProjectFormat }) {
  return (
    <span
      title={format === "video" ? "Video 16:9" : "Reel 9:16"}
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <span
        className={cn(
          "inline-block rounded-[2px] border border-current",
          format === "video" ? "h-2 w-3.5" : "h-3.5 w-2",
        )}
      />
      {format === "video" ? "16:9" : "9:16"}
    </span>
  );
}
