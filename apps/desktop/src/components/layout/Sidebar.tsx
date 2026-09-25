import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router";
import { NAV_SECTIONS, type NavItem, SYSTEM_ITEMS } from "@/app/navigation";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar pb-3 transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        data-tauri-drag-region
        className={cn("flex h-14 shrink-0 items-center gap-2.5", collapsed ? "justify-center" : "px-5")}
      >
        <Logo className="pointer-events-none" />
        {!collapsed && (
          <span className="pointer-events-none text-[15px] font-semibold tracking-tight">
            Guionaria
          </span>
        )}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mt-3">
            {collapsed ? (
              <div className="mx-4 mb-2 border-t" />
            ) : (
              <div className="mb-1.5 px-5 text-[11px] font-medium text-subtle">{section.label}</div>
            )}
            {section.items.map((item) => (
              <SidebarLink key={item.path} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col">
        {SYSTEM_ITEMS.map((item) => (
          <SidebarLink key={item.path} item={item} collapsed={collapsed} />
        ))}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          className={cn(
            "mx-3 mt-1 flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground hover:bg-panel-2 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" strokeWidth={1.6} />
          ) : (
            <>
              <PanelLeftClose className="size-[18px]" strokeWidth={1.6} />
              Contraer barra lateral
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "relative mx-3 my-px flex h-10 items-center gap-3 rounded-md px-3 text-[14px] transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-active font-medium text-active-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
            : "text-foreground/90 hover:bg-panel-2",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.6} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}
