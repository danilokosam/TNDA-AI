# Keyset (Cursor) Pagination for the Document List Endpoint

## Status

Accepted

## Context

`GET /documents` needs to return an organization's document jobs a page at a time, newest first, filterable by status/type/search/date range. The obvious default — offset-based pagination (`LIMIT`/`OFFSET`, or Supabase's `.range()`) — has a real correctness problem for this specific data: rows are inserted continuously and sometimes in bursts, since a single `.zip` batch upload can create many `document_jobs` rows at once. A client paging through results while a new batch is being uploaded (by them, in another tab, or by a teammate) can see offset pagination's classic failure mode — rows shifting between pages, causing skipped or duplicated results — because "page 2" under offset pagination means "whatever is now in positions 20–39," not "the next 20 rows after where I actually left off."

A compound cursor on `(created_at, id)` would remove the (already rare) remaining edge case of two rows sharing the exact same `created_at`, but Supabase's query builder has no direct way to express a compound keyset condition (`(created_at, id) < (cursor_created_at, cursor_id)`) other than its `.or()` raw-filter-string method — which would mean interpolating decoded, client-supplied cursor content into a filter *expression* string, not passing it as a parameterized filter *value*. That trade was judged worse than the risk it would close.

## Decision

Paginate `GET /documents` by keyset on `created_at` alone. The pagination cursor returned to clients (`pagination.nextCursor`) is opaque on the wire — a base64url encoding of the `created_at` value — and clients pass it back exactly as received; nothing about its internal encoding is a contract clients should construct or parse themselves. A cursor that fails to decode to a valid timestamp (malformed, tampered, or simply absent) is treated as "no cursor" — the first page — never as a request error.

## Consequences

- Paging through results stays correct (no skipped or duplicated rows) even while new jobs are actively being inserted, including from a large `.zip` batch upload landing mid-page-through.
- Two jobs created in the exact same instant could, in principle, land on opposite sides of one page boundary. This is accepted as a rare, low-consequence edge case — each row is written by its own separately-awaited round trip, making a true same-instant tie unlikely — rather than solved with a compound cursor and its associated raw-filter-string risk.
- The cursor's internal encoding can change later (e.g., to add a tiebreaker) without breaking any existing client's request shape, since clients only ever echo back an opaque value they were given, never construct one.
- This pattern (opaque, keyset, tolerant of malformed input rather than erroring on it) is the template to reuse for any future paginated list endpoint in this API, not something to redecide per endpoint.
