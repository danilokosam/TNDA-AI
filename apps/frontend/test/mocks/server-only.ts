// Aliased in place of the real `server-only` package for tests (see
// vitest.config.ts). The real package's default export condition throws
// unconditionally ("This module cannot be imported from a Client
// Component module") — Next.js's own bundler resolves it to a no-op via
// the `react-server` exports condition, which plain Vitest doesn't set.
// This file is that same no-op, applied only inside the test run.
export {};
