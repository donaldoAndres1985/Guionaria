import { useEffect } from "react";
import { Outlet } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { useSettings } from "@/hooks/useCore";
import { useJobEvents } from "@/hooks/useJobs";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const { data: settings } = useSettings();
  const theme = settings?.theme ?? "dark";
  useJobEvents();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <Outlet />
      <Toaster theme={theme} />
    </div>
  );
}
