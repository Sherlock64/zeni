import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountsPage } from "@/pages/accounts";
import { CategoriesPage } from "@/pages/categories";
import { NicknamesPage } from "@/pages/nicknames";
import { ReviewPage } from "@/pages/review";
import { SettingsPage } from "@/pages/settings";
import { TransactionsPage } from "@/pages/transactions";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/transactions" });
  },
});

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsPage,
});

const nicknamesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nicknames",
  component: NicknamesPage,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewPage,
});

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/categories",
  component: CategoriesPage,
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  transactionsRoute,
  reviewRoute,
  nicknamesRoute,
  categoriesRoute,
  accountsRoute,
  settingsRoute,
]);

// Hash history: the Tauri webview serves files, not a server that rewrites deep links.
export const router = createRouter({ routeTree, history: createHashHistory() });
