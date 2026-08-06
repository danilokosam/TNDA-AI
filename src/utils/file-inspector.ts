import { fileTypeFromBuffer } from "file-type";
import { PDFDocument } from "pdf-lib";
import { UnsupportedFileTypeError, ValidationError } from "@/utils/errors";

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
] as const;

export type SupportedDocumentMimeType = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];

function isSupportedMimeType(mime: string): mime is SupportedDocumentMimeType {
  return (SUPPORTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export interface InspectedFile {
  fileName: string;
  mimeType: SupportedDocumentMimeType;
  sizeBytes: number;
  pageCount: number;
}

/**
 * Determines a file's true MIME type from its magic bytes (never trusting
 * the client-supplied `Content-Type`) and, for PDFs, its page count. Only
 * reads the PDF's cross-reference/page tree, not the full page contents, so
 * this stays cheap even for large documents.
 */
export async function inspectDocumentFile(
  fileName: string,
  bytes: Uint8Array,
): Promise<InspectedFile> {
  const detected = await fileTypeFromBuffer(bytes);

  if (!detected || !isSupportedMimeType(detected.mime)) {
    throw new UnsupportedFileTypeError(
      `"${fileName}" is not a supported document type. Allowed types: PDF, PNG, JPEG, TIFF, BMP.`,
      { fileName, detectedMimeType: detected?.mime ?? "unknown" },
    );
  }

  const pageCount =
    detected.mime === "application/pdf" ? await getPdfPageCount(fileName, bytes) : 1;

  return {
    fileName,
    mimeType: detected.mime,
    sizeBytes: bytes.byteLength,
    pageCount,
  };
}

async function getPdfPageCount(fileName: string, bytes: Uint8Array): Promise<number> {
  try {
    const pdf = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
    });
    return pdf.getPageCount();
  } catch {
    throw new ValidationError(`"${fileName}" could not be read as a valid PDF.`, { fileName });
  }
}
