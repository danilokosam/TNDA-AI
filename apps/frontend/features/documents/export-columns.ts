import { extractDocumentFields } from "@/features/results/extract-fields";
import type { JobDto } from "@/types/api";

export interface ExportColumnOption {
  field: string;
  defaultLabel: string;
}

/** Mirrors the backend's `documents.export.configuration.ts#METADATA_COLUMNS` field keys and default labels exactly. */
const METADATA_COLUMNS: ExportColumnOption[] = [
  { field: "jobId", defaultLabel: "Job ID" },
  { field: "fileName", defaultLabel: "File Name" },
  { field: "documentType", defaultLabel: "Document Type" },
  { field: "reviewStatus", defaultLabel: "Review Status" },
  { field: "averageConfidence", defaultLabel: "Average Confidence" },
  { field: "createdAt", defaultLabel: "Uploaded At" },
];

/**
 * The columns the "Customize columns" dialog offers: the fixed metadata
 * columns, plus the alphabetically-sorted union of dynamic field names
 * found across `jobs` — the Documents page's currently-loaded (i.e.
 * currently-visible) page of rows, via the same `extractDocumentFields`
 * the Results page already uses. This is a client-side approximation, not
 * a query against the full filtered set: a field that exists only on a
 * document outside the currently-loaded page won't appear as a checkbox
 * option here (it's still included by the plain, non-customized export —
 * see docs/adr/0015-configurable-export-formats.md for why a dedicated
 * "list available fields" backend endpoint wasn't added for this MVP).
 */
export function deriveAvailableExportColumns(jobs: JobDto[]): ExportColumnOption[] {
  const dynamicFieldNames = Array.from(
    new Set(jobs.flatMap((job) => extractDocumentFields(job.resultJson).map((field) => field.name))),
  ).sort();

  return [...METADATA_COLUMNS, ...dynamicFieldNames.map((name) => ({ field: name, defaultLabel: name }))];
}
