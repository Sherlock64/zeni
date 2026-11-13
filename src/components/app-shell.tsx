import { Link, Outlet, useLocation, useRouterState } from "@tanstack/react-router";
import { ReceiptTextIcon, SettingsIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAppInfo } from "@/hooks/use-app-info";

const navItems = [
  { to: "/transactions", label: "Transactions", icon: ReceiptTextIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell() {
  const info = useAppInfo();
  // The resolved location updates only once the new page has rendered.
  const shownPathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
  const previousPathname = useRef(shownPathname);

  // Tell keyboard and screen-reader users the page changed; leave focus alone on the initial load.
  useEffect(() => {
    if (previousPathname.current) document.querySelector<HTMLElement>("main h1")?.focus();
    previousPathname.current = shownPathname;
  }, [shownPathname]);

  // Without its database Zeni can't do anything, so block the app. Other errors are shown where they happen.
  if (info.error?.kind === "Database") {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Zeni</h1>
        <div className="w-full max-w-lg">
          <CommandErrorAlert title="Zeni couldn't open its database" error={info.error} />
        </div>
      </main>
    );
  }

  return (
    <SidebarProvider>
      <AppLayout />
    </SidebarProvider>
  );
}

function AppLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, open, openMobile, setOpenMobile, state } = useSidebar();

  return (
    <>
      {/* inert keeps the links of a slid-away sidebar out of the tab order. */}
      <Sidebar inert={!isMobile && state === "collapsed"}>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
            >
              Z
            </span>
            <span className="text-base font-semibold tracking-tight">Zeni</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Main">
                <SidebarMenu>
                  {navItems.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={pathname === to} className="data-active:[&_svg]:text-sidebar-primary">
                        {/* On narrow windows the sidebar is a modal sheet; close it so the new page gets focus. */}
                        <Link to={to} onClick={() => isMobile && setOpenMobile(false)}>
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-2">
          <SidebarTrigger aria-expanded={isMobile ? openMobile : open} />
        </header>
        <Outlet />
      </SidebarInset>
    </>
  );
}
