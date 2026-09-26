import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Barra de etapas del proyecto: completa, solo iconos o automática (iconos en Escenas y Medios). */
export type StagePanelMode = "expanded" | "compact" | "auto";

export const STAGE_PANEL_WIDTH = { min: 200, max: 440, default: 288 } as const;

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Canal del selector del encabezado; null = todos los canales. */
  selectedChannelId: number | null;
  setSelectedChannel: (id: number | null) => void;
  stagePanelMode: StagePanelMode;
  setStagePanelMode: (mode: StagePanelMode) => void;
  stagePanelWidth: number;
  setStagePanelWidth: (width: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectedChannelId: null,
      setSelectedChannel: (id) => set({ selectedChannelId: id }),
      stagePanelMode: "expanded",
      setStagePanelMode: (mode) => set({ stagePanelMode: mode }),
      stagePanelWidth: STAGE_PANEL_WIDTH.default,
      setStagePanelWidth: (width) =>
        set({
          stagePanelWidth: Math.round(
            Math.min(STAGE_PANEL_WIDTH.max, Math.max(STAGE_PANEL_WIDTH.min, width)),
          ),
        }),
    }),
    { name: "guionaria-ui" },
  ),
);
