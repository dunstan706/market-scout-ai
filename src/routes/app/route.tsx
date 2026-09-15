import { createFileRoute, Outlet } from "@tanstack/react-router";

// Path-through layout for the market workspace (/app/*). Each page renders
// its own WorkspaceShell (with nav + constellation), so this layout only
// mounts the matched child route.
export const Route = createFileRoute("/app")({
  staticData: { sitemap: false },
  component: () => <Outlet />,
});
