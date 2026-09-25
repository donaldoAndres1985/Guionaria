import { useEffect } from "react";
import { Outlet } from "react-router";
import { useSettings } from "@/hooks/useCore";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const { data: settings } = useSettings();

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? "dark";
  }, [settings?.theme]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <Outlet />
    </div>
  );
}
