import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter
} from "@tanstack/react-router";
import { AppShell } from "./components/layout/AppShell";

const rootRoute = createRootRoute({
  component: () => <Outlet />
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: AppShell
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent"
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
