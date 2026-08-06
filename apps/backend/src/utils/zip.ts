import { unzipSync } from "fflate";
import { ValidationError } from "@/utils/errors";

export interface ZipEntry {
  fileName: string;
  bytes: Uint8Array;
}

const IGNORED_ENTRY_PATTERNS = [
  /^__MACOSX\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/i,
];

function isIgnorableEntry(path: string): boolean {
  return IGNORED_ENTRY_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Decompresses a `.zip` archive fully in memory (no temp files on disk) and
 * returns each contained file's raw bytes. Directory entries, macOS
 * metadata junk, and hidden files are filtered out before the caller ever
 * sees them; actual document-type/quota validation happens per-file
 * afterwards via `inspectDocumentFile`.
 */
export function extractZipEntries(archiveBytes: Uint8Array): ZipEntry[] {
  let unzipped: Record<string, Uint8Array>;

  try {
    unzipped = unzipSync(archiveBytes);
  } catch {
    throw new ValidationError("The uploaded file is not a valid .zip archive.");
  }

  const entries: ZipEntry[] = [];

  for (const [path, bytes] of Object.entries(unzipped)) {
    const isDirectory = path.endsWith("/");
    if (isDirectory || bytes.byteLength === 0 || isIgnorableEntry(path)) {
      continue;
    }

    const fileName = path.split("/").pop();
    if (!fileName) {
      continue;
    }

    entries.push({ fileName, bytes });
  }

  return entries;
}
