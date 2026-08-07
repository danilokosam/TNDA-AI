import type { DocumentJobStatus, DocumentType } from "@/types/api";

export interface DocumentsFilters {
  status?: DocumentJobStatus;
  documentType?: DocumentType;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * `cursors` is the stack of page-start cursors already visited — the
 * current page's cursor is its last entry, `undefined` (empty stack) for
 * page 1. `GET /documents`'s cursor is forward-only (a page only carries
 * the next one), so "go back" means popping a cursor this UI already saw,
 * not asking the API for one.
 */
export interface DocumentsListState {
  filters: DocumentsFilters;
  cursors: string[];
}

export type DocumentsListAction =
  | { type: "set-filter"; key: keyof DocumentsFilters; value: string | undefined }
  | { type: "reset-filters" }
  | { type: "next-page"; cursor: string }
  | { type: "prev-page" };

export const initialDocumentsListState: DocumentsListState = { filters: {}, cursors: [] };

/**
 * Changing any filter resets pagination — a cursor collected under the
 * previous filter set doesn't correspond to a position in the new,
 * differently-filtered result set.
 */
export function documentsListReducer(state: DocumentsListState, action: DocumentsListAction): DocumentsListState {
  switch (action.type) {
    case "set-filter": {
      // Written through `Record<string, ...>` rather than `DocumentsFilters`
      // directly — TypeScript can't verify a write through a generic
      // `keyof` is safe per-branch, same reasoning `DocumentTypeSelect`
      // already casts its native <select>'s value: the real safety comes
      // from callers only ever passing a value that came from a
      // corresponding <select>/<input>, not from this reducer re-deriving it.
      const nextFilters: Record<string, string | undefined> = { ...state.filters };
      if (action.value) {
        nextFilters[action.key] = action.value;
      } else {
        delete nextFilters[action.key];
      }
      return { filters: nextFilters as DocumentsFilters, cursors: [] };
    }
    case "reset-filters":
      return { filters: {}, cursors: [] };
    case "next-page":
      return { ...state, cursors: [...state.cursors, action.cursor] };
    case "prev-page":
      return { ...state, cursors: state.cursors.slice(0, -1) };
  }
}

/** The cursor for the page currently being viewed — `undefined` for page 1. */
export function currentCursor(state: DocumentsListState): string | undefined {
  return state.cursors.at(-1);
}
