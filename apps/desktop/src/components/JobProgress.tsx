import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job } from "@/lib/api";
import { formatDuration } from "@/lib/project";

/** Progreso de un trabajo en segundo plano con cronómetro. */
export function JobProgress({
  job,
  fallback,
  hint,
}: {
  job: Job | undefined;
  fallback: string;
  hint: string;
}) {
  const started = job ? Date.parse(job.created_at) : Date.now();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - started) / 1000));

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-lg bg-active text-brand">
        <LoaderCircle className="size-6 animate-spin" />
      </div>
      <div className="text-[15px] font-medium">{job?.message ?? fallback}</div>
      <div className="font-mono text-[13px] text-brand">{formatDuration(seconds)}</div>
      <p className="max-w-sm text-[13px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-[13px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
      <span className="selectable flex-1">{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function NoticeBanner({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-5 py-2 text-[13px]">
      <TriangleAlert className="size-4 shrink-0 text-warning" />
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}
