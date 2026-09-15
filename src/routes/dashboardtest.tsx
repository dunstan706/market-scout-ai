import { createFileRoute, Navigate } from "@tanstack/react-router";

// Both dashboards now live under /dashboard, switched with the top-right
// toggle. /dashboardtest is kept as an alias so old links still work.
export const Route = createFileRoute("/dashboardtest")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
  component: DashboardTestRedirect,
});

function DashboardTestRedirect() {
  return <Navigate to="/dashboard" replace />;
}