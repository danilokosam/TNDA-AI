import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        // Force zod through Vitest's own transform pipeline instead of
        // Bun's native module resolver. Zod 3.25's package.json exports a
        // "@zod/source" condition pointing at raw .ts source (a Vite<->Zod
        // integration for nicer stack traces), alongside its normal
        // compiled "import"/"require" entries — which of those gets
        // picked can depend on the exact Bun patch version's own
        // exports-condition handling. Inlining pins it to one consistent,
        // JS-based resolution path regardless of which Bun build the
        // tests happen to run under.
        inline: ["zod"],
      },
    },
    // Dummy, non-secret values only — satisfy env.ts's Zod schema (which
    // is validated eagerly at import time) so unit tests never need real
    // Supabase/Azure/Stripe credentials. Tests that need to exercise real
    // network calls belong in scripts/test-e2e-*.ts, not here.
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_JWT_SECRET: "test-jwt-secret",
      AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://test.cognitiveservices.azure.com",
      AZURE_DOCUMENT_INTELLIGENCE_API_KEY: "test-azure-key",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_dummy_secret_for_unit_tests",
      STRIPE_PRICE_ID_BASIC: "price_test_basic",
      STRIPE_PRICE_ID_PRO: "price_test_pro",
    },
  },
});
