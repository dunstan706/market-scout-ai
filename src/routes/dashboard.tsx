import { createFileRoute } from "@tanstack/react-router";
import { DashboardHost } from "@/components/DashboardHost";

export const Route = createFileRoute("/dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Dashboard — theBizScope" },
      {
        name: "description",
        content: "Your theBizScope dashboard — business profile, market monitoring, and weekly briefs.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardHost,
});