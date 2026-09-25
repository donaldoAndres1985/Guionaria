import { createHashRouter } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { CalendarPage } from "@/pages/Calendar";
import { ChannelsPage } from "@/pages/Channels";
import { HistoryPage } from "@/pages/History";
import { HomePage } from "@/pages/Home";
import { IdeasPage } from "@/pages/Ideas";
import { MediaPage } from "@/pages/Media";
import { ProjectsPage } from "@/pages/Projects";
import { PublishingPage } from "@/pages/Publishing";
import { SettingsPage } from "@/pages/Settings";
import { SfxMusicPage } from "@/pages/SfxMusic";
import { StoragePage } from "@/pages/Storage";

// Hash router: el webview de Tauri sirve archivos estáticos y no reescribe rutas a index.html.
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "proyectos", element: <ProjectsPage /> },
      { path: "ideas", element: <IdeasPage /> },
      { path: "calendario", element: <CalendarPage /> },
      { path: "medios", element: <MediaPage /> },
      { path: "sfx-musica", element: <SfxMusicPage /> },
      { path: "almacenamiento", element: <StoragePage /> },
      { path: "canales", element: <ChannelsPage /> },
      { path: "publicacion", element: <PublishingPage /> },
      { path: "historial", element: <HistoryPage /> },
      { path: "ajustes", element: <SettingsPage /> },
    ],
  },
]);
