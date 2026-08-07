# Session-Only Document Preview Behind a Swappable Abstraction

## Status

Accepted

## Context

The Results page needs to show the user a preview of the document they uploaded, alongside its extracted fields. The backend never persists an uploaded file anywhere — it is read into memory, validated, submitted to Azure, and discarded once processing has been kicked off (see the document-processing flow) — so there is no backend-provided URL to point a preview at, for any job, ever, under the system as currently built. Building real file persistence (object storage, a new backend endpoint to serve it, retention/lifecycle policy for it) is real infrastructure work, and is not needed for the case that actually matters for this version of the product: a user uploads a document and wants to see it right after, alongside its results.

That immediate upload-to-results case has something a later visit to the same job doesn't: the actual `File` object the user selected is still sitting in memory, in the upload queue's own client-side state, at the moment of upload. It just isn't reachable from the Results page today, because that page is a different route, and the queue's state doesn't survive a client-side navigation to it on its own.

## Decision

Cache the just-uploaded `File`, client-side only, keyed by the job id it produced, in a plain module-level map — not React state, not a Context, not anything persisted to storage. This survives a client-side route change (the module isn't re-evaluated on navigation within the same page load) but disappears on a real page reload, which matches the intended scope exactly: this is a best-effort preview for the immediate post-upload session, not a persistent feature.

Expose this behind a `DocumentPreviewSource` union type with three explicit states: a `session-blob` (the cached file is available; render it via `URL.createObjectURL`, revoked when no longer needed), a `remote-url` (a persistent, backend-provided URL — not produced by anything today, but reserved so this can slot in later without any UI change), and `unavailable` (no file to preview — the honest state for any job reached outside the immediate upload flow, such as a reloaded results page or a job opened from a future history list). No UI component that renders a preview needs to know which of the three it's showing beyond branching on this union.

## Consequences

- A preview works, immediately, for the case that matters most (just uploaded, viewing results right after) — with no new backend or storage infrastructure required to ship it.
- Opening any other job's results page — after a reload, or from a future history view — correctly and explicitly shows "preview unavailable" rather than a broken image or a silently stale one. This is treated as expected behavior, not a bug to route around.
- If real file persistence is ever built, only the `remote-url` branch's producer needs to be written — every consuming UI component already has a valid, exercised code path for it, since the union already accounts for it.
- The cached file's lifetime is real memory held for as long as the browser tab's page load lasts, or until it's superseded — a cost accepted as reasonable for one recently-uploaded file, not something requiring an eviction policy at this scale.
