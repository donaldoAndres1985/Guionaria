import { Clapperboard, Plus } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { BottomBar } from "@/components/layout/BottomBar";
import { ChannelSelector } from "@/components/layout/ChannelSelector";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { useHealth } from "@/hooks/useCore";

export function HomePage() {
  const { data: health } = useHealth();
  const missingRequired = health?.dependencies.filter((d) => d.required && !d.ok) ?? [];

  return (
    <PageLayout
      title="Inicio"
      actions={<ChannelSelector />}
      bottomBar={
        <BottomBar
          stats={[
            { label: "Proyectos activos", value: 0 },
            { label: "Por publicar", value: 0 },
          ]}
        >
          <Button size="lg" disabled title="Disponible en la Fase 1">
            <Plus />
            Nuevo proyecto
          </Button>
        </BottomBar>
      }
    >
      <EmptyState
        icon={Clapperboard}
        title="Sin proyectos todavía"
        description="Aquí verás lo pendiente de cada canal y lo próximo a publicar. Los canales y proyectos llegan en la Fase 1."
        action={
          missingRequired.length > 0 ? (
            <Button variant="outline" asChild>
              <Link to="/ajustes">
                Faltan {missingRequired.length} dependencias requeridas · Revisar en Ajustes
              </Link>
            </Button>
          ) : undefined
        }
      />
    </PageLayout>
  );
}
