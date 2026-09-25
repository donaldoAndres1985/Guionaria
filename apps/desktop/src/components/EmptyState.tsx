import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** Estado vacío con acción clara (sección 15.4). */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-lg bg-active text-brand">
        <Icon className="size-6" strokeWidth={1.6} />
      </div>
      <div className="text-[15px] font-medium">{title}</div>
      {description && (
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
