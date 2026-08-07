import { describe, expect, it } from "vitest";
import {
  currentCursor,
  documentsListReducer,
  initialDocumentsListState,
  type DocumentsListState,
} from "@/features/documents/filters";

function stateFixture(overrides: Partial<DocumentsListState> = {}): DocumentsListState {
  return { ...initialDocumentsListState, ...overrides };
}

describe("documentsListReducer", () => {
  it("sets a filter and resets pagination to page 1", () => {
    const state = stateFixture({ cursors: ["page2cursor"] });

    const next = documentsListReducer(state, { type: "set-filter", key: "status", value: "completed" });

    expect(next.filters.status).toBe("completed");
    expect(next.cursors).toEqual([]);
  });

  it("removes the filter key entirely when set to an empty value, rather than storing an empty string", () => {
    const state = stateFixture({ filters: { status: "completed" } });

    const next = documentsListReducer(state, { type: "set-filter", key: "status", value: "" });

    expect(next.filters.status).toBeUndefined();
    expect("status" in next.filters).toBe(false);
  });

  it("preserves other existing filters when setting one", () => {
    const state = stateFixture({ filters: { status: "completed", search: "acme" } });

    const next = documentsListReducer(state, { type: "set-filter", key: "documentType", value: "invoice" });

    expect(next.filters).toEqual({ status: "completed", search: "acme", documentType: "invoice" });
  });

  it("clears every filter on reset-filters, and resets pagination too", () => {
    const state = stateFixture({ filters: { status: "failed", search: "x" }, cursors: ["a", "b"] });

    const next = documentsListReducer(state, { type: "reset-filters" });

    expect(next.filters).toEqual({});
    expect(next.cursors).toEqual([]);
  });

  it("pushes a cursor onto the stack on next-page", () => {
    const state = stateFixture();

    const next = documentsListReducer(state, { type: "next-page", cursor: "cursor1" });

    expect(next.cursors).toEqual(["cursor1"]);
  });

  it("builds a multi-page stack across repeated next-page actions", () => {
    let state = stateFixture();
    state = documentsListReducer(state, { type: "next-page", cursor: "cursor1" });
    state = documentsListReducer(state, { type: "next-page", cursor: "cursor2" });

    expect(state.cursors).toEqual(["cursor1", "cursor2"]);
  });

  it("pops the last cursor on prev-page", () => {
    const state = stateFixture({ cursors: ["cursor1", "cursor2"] });

    const next = documentsListReducer(state, { type: "prev-page" });

    expect(next.cursors).toEqual(["cursor1"]);
  });

  it("prev-page on an already-empty stack is a no-op, not an error", () => {
    const state = stateFixture();

    const next = documentsListReducer(state, { type: "prev-page" });

    expect(next.cursors).toEqual([]);
  });

  it("next-page/prev-page leave filters untouched", () => {
    const state = stateFixture({ filters: { status: "completed" } });

    const next = documentsListReducer(state, { type: "next-page", cursor: "c1" });

    expect(next.filters).toEqual({ status: "completed" });
  });
});

describe("currentCursor", () => {
  it("is undefined for page 1 (empty cursor stack)", () => {
    expect(currentCursor(initialDocumentsListState)).toBeUndefined();
  });

  it("is the most recently pushed cursor", () => {
    expect(currentCursor(stateFixture({ cursors: ["a", "b", "c"] }))).toBe("c");
  });
});
