# Call Azure Document Intelligence's REST API Directly, Not Through Its SDK

## Status

Accepted

## Context

Azure Document Intelligence's analysis endpoints are asynchronous: submitting a document returns `202 Accepted` with an `Operation-Location` URL, which must be polled until the analysis finishes. The official `@azure/ai-form-recognizer` SDK provides a poller (`beginAnalyzeDocument`) that handles this submit-then-poll cycle for the caller, but it is designed to poll within one continuous, in-process operation — call it, `await` it, get a result back from the same function call.

This backend's job model does not fit that shape. A document job is submitted, an `Operation-Location` is persisted to `document_jobs.azure_operation_id`, and the response is returned to the client immediately (`202`, `status: "processing"`) rather than blocking the request until Azure finishes. Status is then checked later, from a **separate, later HTTP request** (`GET /documents/jobs/:id`) — potentially handled by a different server process entirely, with no in-memory continuity from the original submission at all. The SDK's poller has no way to be handed an already-in-flight operation from a previous process and asked to resume checking it.

## Decision

Call Azure Document Intelligence's REST API directly via `fetch`, implementing the submit/poll protocol by hand: `POST {endpoint}/documentModels/{modelId}:analyze` to submit, capturing the `Operation-Location` header; a separate `GET` against that URL, whenever a status check is actually needed, to poll. `429 Too Many Requests` responses (on either call) are retried automatically with exponential backoff and jitter, honoring Azure's `Retry-After` header when present. `@azure/ai-form-recognizer` is not a dependency of this project.

The adapter that does this (`azure-document-intelligence.service.ts`) takes the model id as a parameter and has no opinion on which model any given document should use — that decision belongs to the domain layer, not this infrastructure adapter (see the document-type-to-model strategy registry it's called from).

## Consequences

- Status polling naturally supports the "submitted by one request, checked by a later, unrelated request" shape this backend's job model requires, with no in-process state to somehow keep alive or hand off between requests.
- The backend owns and maintains its own thin submit/poll implementation instead of depending on the SDK's abstraction — a small, deliberate maintenance surface in exchange for fitting the actual request/response lifecycle this system needs.
- Only *submission* is abstracted at the model-selection layer; status polling and the persisted `Operation-Location` still assume Azure's specific asynchronous-operation model. A genuinely different provider (not just a different Azure model) would need its own polling story addressed too — not handled by this decision, and not generalized speculatively ahead of an actual need for it.
