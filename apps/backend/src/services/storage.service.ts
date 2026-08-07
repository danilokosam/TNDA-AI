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

export async function deleteDocumentFile(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", `Failed to delete the stored file: ${error.message}`);
  }
}
