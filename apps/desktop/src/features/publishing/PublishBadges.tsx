import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PLATFORM_TONE } from "./publishingMeta";

const LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const STATUS: Record<string, string> = {
  draft: "pendiente",
  scheduled: "programado",
  uploading: "subiendo",
  published: "publicado",
  failed: "falló",
};

/** «1/3 publicadas» y un punto por plataforma (lleno = publicado, con aro = programado). */
export function publishProgress(project: Pick<Project, "publications">): { done: number; total: number } {
  const list = project.publications ?? [];
  return { done: list.filter((p) => p.status === "published").length, total: list.length };
}

export function PublishBadges({ project, className }: { project: Pick<Project, "publications">; className?: string }) {
  const list = project.publications ?? [];
  if (!list.length) return null;
  const { done, total } = publishProgress(project);
  const title = list.map((p) => `${LABEL[p.platform] ?? p.platform}: ${STATUS[p.status] ?? p.status}`).join(" · ");
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground", className)} title={title} data-testid="publish-badges">
      {list.map((p) => (
        <span
          key={p.platform}
          aria-label={`${LABEL[p.platform] ?? p.platform}: ${STATUS[p.status] ?? p.status}`}
          className={cn(
            "size-2 rounded-full",
            p.status === "published"
              ? PLATFORM_TONE[p.platform as keyof typeof PLATFORM_TONE]
              : p.status === "scheduled"
                ? "ring-1 ring-brand"
                : "bg-panel-2 ring-1 ring-border",
          )}
        />
      ))}
      <span className="font-mono">
        {done}/{total}
      </span>
    </span>
  );
}
