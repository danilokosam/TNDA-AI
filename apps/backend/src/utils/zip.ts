import { Unzip, UnzipInflate } from "fflate";
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
 * Resource ceilings against decompression-bomb archives — a small, highly
 * compressed `.zip` that expands to gigabytes in memory. Chosen well above
 * any real plan's limits (the largest, `pro`, allows 50MB/file, §`plans`
 * seed data) so a legitimate upload is never rejected by these; anything
 * beyond them is already guaranteed to fail the real per-file plan check
 * downstream in `documents.service.ts`, just without ever fully
 * decompressing first.
 */
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;

/**
 * The archive is fed to the decompressor in bounded pieces, not all at
 * once, so a single wildly-compressed entry is caught mid-expansion by the
 * checks in `ondata` below, rather than only after fully decompressing (the
 * `unzipSync` behavior this replaces, which decompresses the entire archive
 * in one call before any check can run).
 */
const PUSH_CHUNK_BYTES = 64 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_RECORD_SIZE = 22;
const MAX_EOCD_COMMENT_BYTES = 65535;

/**
 * A cheap, upfront structural check — mirrors what `unzipSync` itself does
 * internally — so a buffer that isn't a zip archive at all is rejected
 * before any streaming/decompression work starts. The streaming `Unzip`
 * reader below only recognizes entries via their local file headers; unlike
 * `unzipSync`, it has no reason to notice a completely absent end-of-
 * central-directory record on its own, so this check preserves the
 * existing "not a valid zip" behavior for non-zip input.
 */
function hasEndOfCentralDirectoryRecord(bytes: Uint8Array): boolean {
  if (bytes.length < EOCD_RECORD_SIZE) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(0, bytes.length - EOCD_RECORD_SIZE - MAX_EOCD_COMMENT_BYTES);

  for (let offset = bytes.length - EOCD_RECORD_SIZE; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return true;
    }
  }

  return false;
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

/**
 * Decompresses a `.zip` archive and returns each contained file's raw
 * bytes. Directory entries, macOS metadata junk, and hidden files are
 * filtered out before the caller ever sees them; actual document-type/quota
 * validation happens per-file afterwards via `inspectDocumentFile`.
 *
 * Streams the archive through fflate's incremental `Unzip` API rather than
 * `unzipSync` (which decompresses everything into memory in one call before
 * any validation can run) so entry count and decompressed size are enforced
 * *during* extraction: an entry's declared size is checked upfront where
 * available, and the real, cumulative decompressed byte count is tracked
 * and enforced as data actually streams out — so an archive whose header
 * lies about size (or never declares one at all) is caught exactly the same
 * way as one that's honest about it. Bounded by `MAX_ZIP_*` above.
 */
export function extractZipEntries(archiveBytes: Uint8Array): ZipEntry[] {
  if (!hasEndOfCentralDirectoryRecord(archiveBytes)) {
    throw new ValidationError("The uploaded file is not a valid .zip archive.");
  }

  const entries: ZipEntry[] = [];
  let entryCount = 0;
  let totalBytes = 0;
  let aborted: Error | null = null;

  const unzipper = new Unzip((file) => {
    if (aborted) return;

    entryCount += 1;
    if (entryCount > MAX_ZIP_ENTRIES) {
      aborted = new ValidationError(`The archive contains more than ${MAX_ZIP_ENTRIES} files.`);
      return;
    }

    const isDirectory = file.name.endsWith("/");
    if (isDirectory || isIgnorableEntry(file.name)) {
      return;
    }

    const fileName = file.name.split("/").pop();
    if (!fileName) return;

    if (file.originalSize !== undefined && file.originalSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
      aborted = new ValidationError(
        `"${fileName}" would decompress to more than the ${formatMb(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES)}MB per-file limit.`,
      );
      return;
    }

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;

    file.ondata = (error, chunk, final) => {
      if (aborted) return;

      if (error) {
        aborted = new ValidationError("The uploaded file is not a valid .zip archive.");
        return;
      }

      entryBytes += chunk.byteLength;
      totalBytes += chunk.byteLength;

      if (entryBytes > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
        aborted = new ValidationError(
          `"${fileName}" exceeds the ${formatMb(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES)}MB per-file decompressed-size limit.`,
        );
        file.terminate();
        return;
      }

      if (totalBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        aborted = new ValidationError(
          `The archive's total decompressed size exceeds the ${formatMb(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES)}MB limit.`,
        );
        file.terminate();
        return;
      }

      chunks.push(chunk);
      if (final && entryBytes > 0) {
        entries.push({ fileName, bytes: concatChunks(chunks, entryBytes) });
      }
    };

    file.start();
  });

  unzipper.register(UnzipInflate);

  try {
    let offset = 0;
    do {
      if (aborted) break;
      const end = Math.min(offset + PUSH_CHUNK_BYTES, archiveBytes.length);
      const isFinalChunk = end >= archiveBytes.length;
      unzipper.push(archiveBytes.subarray(offset, end), isFinalChunk);
      offset = end;
    } while (offset < archiveBytes.length);
  } catch {
    if (!aborted) {
      throw new ValidationError("The uploaded file is not a valid .zip archive.");
    }
  }

  if (aborted) {
    throw aborted;
  }

  return entries;
}
