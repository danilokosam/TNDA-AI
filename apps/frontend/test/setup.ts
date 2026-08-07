import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's auto-cleanup normally self-registers via a
// global `afterEach` — but this project deliberately imports
// describe/it/expect/etc. from "vitest" per-file rather than enabling
// `test.globals`, so that auto-detection never fires and DOM from one
// test leaks into the next (surfaces as "multiple elements found").
// Registered explicitly here instead.
afterEach(() => {
  cleanup();
});
