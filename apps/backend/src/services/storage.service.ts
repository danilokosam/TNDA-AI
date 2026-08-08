import { supabaseAdmin } from "@/config/supabase";
import { env } from "@/config/env";
import { AppError } from "@/utils/errors";

/**
 * External-adapter for Supabase Storage, mirroring
 * `azure-document-intelligence.service.ts`'s shape — thin wrappers over
 * the real client, no business logic of its own. Uses `supabaseAdmin`
 * (already the service-role client every repository uses) rather than a
 * separate credential; Storage operations authenticate the same way
 * `.from("table")` calls already do.
 */

/** `{organizationId}/{jobId}/{fileName}` — see migration 0011's RLS policy, which checks the first path segment. */
export function buildStoragePath(organizationId: string, jobId: string, fileName: string): string {
  return `${organizationId}/${jobId}/${fileName}`;
}

export async function uploadDocumentFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", `Failed to store the uploaded file: ${error.message}`);
  }
}

/** Defaults to a 1-hour expiry — long enough for one Results-page visit, short enough not to be a durable public link. */
export async function createSignedPreviewUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new AppError(
      500,
      "INTERNAL_ERROR",
      `Failed to create a signed preview URL: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.signedUrl;
}

/**
 * Wave 3 Phase 2 — the worker's only way to obtain a claimed job's bytes,
 * since it runs in a separate process with no access to the original
 * upload request's in-memory data. Returns raw bytes only, deliberately
 * not a `SupportedDocumentMimeType` — the caller re-derives that from the
 * bytes themselves via `file-inspector.ts#inspectDocumentFile`, the same
 * magic-byte detection already trusted at upload time, rather than
 * trusting Storage's own stored content-type metadata uncritically.
 */
export async function downloadDocumentFile(path: string): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).download(path);

  if (error || !data) {
    throw new AppError(500, "INTERNAL_ERROR", `Failed to download the stored file: ${error?.message ?? "unknown error"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export async function deleteDocumentFile(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", `Failed to delete the stored file: ${error.message}`);
  }
}
