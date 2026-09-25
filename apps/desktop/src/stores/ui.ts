import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Canal del selector del encabezado; null = todos los canales. */
  selectedChannelId: number | null;
  setSelectedChannel: (id: number | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectedChannelId: null,
      setSelectedChannel: (id) => set({ selectedChannelId: id }),
    }),
    { name: "guionaria-ui" },
  ),
);
