import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectDocumentFile } from "@/utils/file-inspector";
import { UnsupportedFileTypeError, ValidationError } from "@/utils/errors";

async function realPdfBytes(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdf.addPage();
  }
  return pdf.save();
}

// Standard magic-byte signatures for each supported format, padded with
// filler bytes — real detection is by content, not filename or extension,
// so these deliberately carry no meaningful extension in their test names.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(0)]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(32).fill(0)]);
// A structurally complete (if content-less) little-endian TIFF: signature,
// then an IFD offset pointing straight at an empty IFD (0 entries, no next
// IFD) — not just a signature followed by zero padding, which the real
// TIFF parser reads as a bogus IFD offset and throws End-Of-Stream on.
const TIFF_LE_BYTES = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const BMP_BYTES = new Uint8Array([0x42, 0x4d, ...new Array(32).fill(0)]);
const NOT_A_DOCUMENT_BYTES = new TextEncoder().encode("just plain text, not any recognized binary format at all");

describe("inspectDocumentFile", () => {
  it.each([
    ["image/png", PNG_BYTES],
    ["image/jpeg", JPEG_BYTES],
    ["image/tiff", TIFF_LE_BYTES],
    ["image/bmp", BMP_BYTES],
  ])("classifies a real %s file correctly, from its bytes", async (expectedMime, bytes) => {
    const result = await inspectDocumentFile("upload.bin", bytes);

    expect(result.mimeType).toBe(expectedMime);
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.pageCount).toBe(1);
  });

  it("classifies by real content, not by filename or its extension — the actual security invariant this module exists for", async () => {
    // Named like a PDF, but its bytes are a real PNG. If this module ever
    // trusted the filename/extension instead of sniffing content, this
    // would be misclassified as a PDF (and fail, or worse, silently
    // process the wrong parser) instead of correctly reporting PNG.
    const result = await inspectDocumentFile("invoice.pdf", PNG_BYTES);

    expect(result.mimeType).toBe("image/png");
  });

  it("rejects a file with a recognizable-but-corrupt structure as unsupported, rather than crashing with an unhandled exception", async () => {
    // A real TIFF signature followed by a bogus (all-zero) IFD offset —
    // enough for the underlying detector to *recognize* "this looks like
    // it's trying to be a TIFF" but not enough to actually parse, which
    // makes the detector throw internally rather than return `undefined`.
    // Discovered while writing this test, not a case already documented
    // as handled: `inspectDocumentFile` must still turn this into a clean
    // rejection, the same as any other unsupported/unreadable upload.
    const corruptTiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...new Array(32).fill(0)]);

    const rejection = inspectDocumentFile("corrupt.tiff", corruptTiff);

    await expect(rejection).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("rejects a file whose content isn't a recognized binary format at all", async () => {
    const rejection = inspectDocumentFile("notes.txt", NOT_A_DOCUMENT_BYTES);

    await expect(rejection).rejects.toBeInstanceOf(UnsupportedFileTypeError);
    await expect(rejection).rejects.toMatchObject({ details: { detectedMimeType: "unknown" } });
  });

  it("rejects a real but unsupported binary format (not on the allowlist), even though it's a recognizable file type", async () => {
    // A real ZIP signature — a legitimate, detectable file-type, just not
    // one `inspectDocumentFile` itself accepts (batch .zip uploads are
    // unwrapped by zip.ts *before* each entry reaches this function; a
    // .zip arriving here directly must still be rejected, not silently
    // treated as some allowed type).
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(32).fill(0)]);

    const rejection = inspectDocumentFile("archive.zip", zipBytes);

    await expect(rejection).rejects.toBeInstanceOf(UnsupportedFileTypeError);
    await expect(rejection).rejects.toMatchObject({ details: { detectedMimeType: "application/zip" } });
  });

  it("reports the file's real byte length as sizeBytes, not anything client-supplied", async () => {
    const bytes = PNG_BYTES;

    const result = await inspectDocumentFile("photo.png", bytes);

    expect(result.sizeBytes).toBe(bytes.byteLength);
  });

  describe("PDF-specific handling", () => {
    it("reports the true page count of a real multi-page PDF", async () => {
      const bytes = await realPdfBytes(5);

      const result = await inspectDocumentFile("contract.pdf", bytes);

      expect(result.mimeType).toBe("application/pdf");
      expect(result.pageCount).toBe(5);
    });

    it("reports a single page for a real one-page PDF", async () => {
      const bytes = await realPdfBytes(1);

      const result = await inspectDocumentFile("receipt.pdf", bytes);

      expect(result.pageCount).toBe(1);
    });

    it("rejects a corrupted/unparseable PDF with a clear ValidationError, not an unhandled crash", async () => {
      // Passes MIME detection (a real PDF header) but the structure after
      // it is garbage — pdf-lib's own parser must fail, and that failure
      // has to surface as a normal, catchable AppError, not propagate as
      // an unhandled exception from a malformed-input upload.
      const truncatedPdf = new TextEncoder().encode("%PDF-1.4\nthis is not a real PDF body at all");

      const rejection = inspectDocumentFile("broken.pdf", truncatedPdf);

      await expect(rejection).rejects.toBeInstanceOf(ValidationError);
      await expect(rejection).rejects.toThrow("could not be read as a valid PDF");
    });

    it("never attempts PDF page-count parsing on a non-PDF file, even one containing PDF-like bytes elsewhere in its content", async () => {
      // A PNG whose content happens to contain the literal bytes "%PDF-"
      // somewhere after its real header — must still be classified (and
      // handled) purely as a PNG, never routed into the PDF page-counter.
      const pngWithPdfLookingBytes = new Uint8Array([
        ...PNG_BYTES,
        ...new TextEncoder().encode("%PDF-1.4 not actually relevant"),
      ]);

      const result = await inspectDocumentFile("sneaky.png", pngWithPdfLookingBytes);

      expect(result.mimeType).toBe("image/png");
      expect(result.pageCount).toBe(1);
    });
  });
});
