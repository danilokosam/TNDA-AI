import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
      // The real `server-only` package throws outside Next's own bundler
      // (which resolves it to a no-op via the `react-server` exports
      // condition that plain Vitest doesn't set) — see test/mocks/server-only.ts.
      "server-only": new URL("./test/mocks/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Dummy, non-secret values only — satisfy lib/env.ts's Zod schema
    // (validated eagerly at import time), same reasoning as the backend's
    // own vitest.config.ts.
    env: {
      BACKEND_URL: "http://localhost:3000",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
