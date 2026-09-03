// Standalone config: vitest prefers this file over vite.config.ts, which keeps
// the Lovable/TanStack build plugins out of the test pipeline. Only the path
// alias needs to match so tests can import via "@/...".
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});