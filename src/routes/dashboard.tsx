import { createFileRoute } from "@tanstack/react-router";
import { DashboardHost } from "@/components/DashboardHost";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Localscope" },
      {
        name: "description",
        content: "Your Localscope dashboard — business profile, market monitoring, and weekly briefs.",
      },
    ],
  }),
  component: DashboardHost,
});