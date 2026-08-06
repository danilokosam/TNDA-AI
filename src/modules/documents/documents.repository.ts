import { supabaseAdmin } from "@/config/supabase";
import { AppError, NotFoundError } from "@/utils/errors";
import type { Database } from "@/config/database.types";

export type DocumentJobRow = Database["public"]["Tables"]["document_jobs"]["Row"];
export type DocumentJobInsert = Database["public"]["Tables"]["document_jobs"]["Insert"];
export type DocumentJobUpdate = Database["public"]["Tables"]["document_jobs"]["Update"];

export async function createDocumentJob(input: DocumentJobInsert): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin.from("document_jobs").insert(input).select("*").single();

  if (error || !data) {
    console.error("[documents.repository] createDocumentJob failed", { input, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to create document job.");
  }

  return data;
}

export async function updateDocumentJob(
  id: string,
  patch: DocumentJobUpdate,
): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin
    .from("document_jobs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[documents.repository] updateDocumentJob failed", { id, patch, error });
    throw new AppError(500, "INTERNAL_ERROR", error?.message ?? "Failed to update document job.");
  }

  return data;
}

export async function getDocumentJobForOrganization(
  id: string,
  organizationId: string,
): Promise<DocumentJobRow> {
  const { data, error } = await supabaseAdmin
    .from("document_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }

  if (!data) {
    throw new NotFoundError("Document job not found.");
  }

  return data;
}
