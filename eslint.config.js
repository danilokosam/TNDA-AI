// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // tsconfig's noUnusedLocals/noUnusedParameters (enforced by
      // `bun run typecheck`) already cover this; avoid duplicate reports
      // from two different tools for the same issue.
      "@typescript-eslint/no-unused-vars": "off",
      // The project's own convention (see PROGRESS.md) is zero `as`
      // type assertions anywhere in the codebase; enforce it.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Test files only: mocking a deeply generic external SDK shape
    // (Supabase's PostgrestQueryBuilder/PostgrestFilterBuilder chain has
    // 6+ type parameters per method) without any `any`/`as` at the mock
    // boundary isn't practical, and isn't the same risk as a shortcut in
    // application logic — it's test scaffolding faking an external
    // response shape, not a business-logic correctness gap. The zero-cast
    // rule above still applies everywhere else, including inside test
    // files' actual assertions and fixtures for our own types.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
);
