import { Link, Outlet, useLocation, useRouterState } from "@tanstack/react-router";
import { LandmarkIcon, ReceiptTextIcon, SettingsIcon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppInfo } from "@/hooks/use-app-info";
import { useSecurityStatus } from "@/hooks/use-security-status";
import { SetupPage } from "@/pages/setup";
import { UnlockPage } from "@/pages/unlock";
import type { GateScreenProps } from "@/types/ui";

const navItems = [
  { to: "/transactions", label: "Transactions", icon: ReceiptTextIcon },
  { to: "/accounts", label: "Accounts", icon: LandmarkIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

// A full-window screen without the sidebar, for when the app itself can't be shown yet.
function GateScreen({ children }: GateScreenProps) {
  return <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">{children}</main>;
}

export function AppShell() {
  const info = useAppInfo();
  const status = useSecurityStatus();
  const state = status.data?.state;
  const previousState = useRef(state);
  // The resolved location updates only once the new page has rendered.
  const shownPathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
  const previousPathname = useRef(shownPathname);

  // Tell keyboard and screen-reader users the page changed; leave focus alone on the initial load.
  useEffect(() => {
    if (previousPathname.current) document.querySelector<HTMLElement>("main h1")?.focus();
    previousPathname.current = shownPathname;
  }, [shownPathname]);

  // Setup, unlock and the app swap the whole window, so move focus to the new screen's heading.
  useEffect(() => {
    if (previousState.current && previousState.current !== state) document.querySelector<HTMLElement>("main h1")?.focus();
    previousState.current = state;
  }, [state]);

  // Without its database Zeni can't do anything, so block the app. Other errors are shown where they happen.
  if (info.error?.kind === "Database") {
    return (
      <GateScreen>
        <h1 className="text-2xl font-semibold tracking-tight">Zeni</h1>
        <div className="w-full max-w-lg">
          <CommandErrorAlert title="Zeni couldn't open its database" error={info.error} />
        </div>
      </GateScreen>
    );
  }

  // A failed background refetch keeps the last good status, so only block when there is none.
  if (status.isError && !status.data) {
    return (
      <GateScreen>
        <h1 className="text-2xl font-semibold tracking-tight">Zeni</h1>
        <div className="flex w-full max-w-lg flex-col items-start gap-3">
          <CommandErrorAlert title="Couldn't check Zeni's security status" error={status.error} />
          {/* With no status yet, a refetch shows the loading screen, so this button can't be pressed twice. */}
          <Button variant="outline" onClick={() => status.refetch()}>
            Try again
          </Button>
        </div>
      </GateScreen>
    );
  }

  if (status.isPending) {
    return (
      <GateScreen>
        <h1 className="text-2xl font-semibold tracking-tight">Zeni</h1>
        <p role="status" className="sr-only">
          Loading…
        </p>
        <Skeleton aria-hidden="true" className="h-40 w-full max-w-md" />
      </GateScreen>
    );
  }

  if (status.data.state === "needsSetup") {
    return (
      <GateScreen>
        <SetupPage defaultOwner={status.data.defaultOwner} />
      </GateScreen>
    );
  }

  if (status.data.state === "locked") {
    return (
      <GateScreen>
        <UnlockPage reason={status.data.reason} />
      </GateScreen>
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
