import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";

interface PlaceholderPageProps {
  title: string;
  icon: LucideIcon;
  emptyTitle: string;
  description: string;
  phase: string;
  withChannel?: boolean;
}

/** Pantalla aún no implementada: muestra qué hará y en qué fase llega (sección 17). */
export function PlaceholderPage({
  title,
  icon,
  emptyTitle,
  description,
  phase,
  withChannel = true,
}: PlaceholderPageProps) {
  return (
    <PageLayout title={title} actions={withChannel ? <ChannelSelector /> : undefined}>
      <EmptyState
        icon={icon}
        title={emptyTitle}
        description={description}
        action={
          <span className="rounded-full bg-panel-2 px-3 py-1 text-[12px] text-muted-foreground">
            Disponible en la {phase}
          </span>
        }
      />
    </PageLayout>
  );
}
