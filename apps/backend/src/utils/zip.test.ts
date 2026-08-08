import { describe, expect, it } from "vitest";
import { Zip, ZipDeflate, zipSync } from "fflate";
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  extractZipEntries,
} from "@/utils/zip";
import { ValidationError } from "@/utils/errors";

/**
 * Builds a real zip archive via fflate's streaming `Zip` writer instead of
 * `zipSync`, so the resulting local file header omits the upfront
 * compressed/uncompressed size (the "data descriptor" case — sizes are
 * unknown until the stream ends, exactly like a genuinely-streamed producer
 * would create). This is what lets the entries-under-test exercise
 * `extractZipEntries`'s incremental, real-bytes-counted guard rather than
 * its cheap upfront-declared-size check — the two are independent defenses,
 * and this helper is what proves the incremental one actually works on its
 * own, not just when a header happens to declare the truth upfront.
 */
function zipWithUnknownSizes(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
      if (final) {
        const result = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          result.set(c, offset);
          offset += c.byteLength;
        }
        resolve(result);
      }
    });

    const entry = new ZipDeflate(name);
    archive.add(entry);
    // Two pushes (not one) is what forces fflate's writer to treat this as
    // a genuinely streamed, size-unknown-upfront entry.
    entry.push(bytes.subarray(0, Math.floor(bytes.length / 2)), false);
    entry.push(bytes.subarray(Math.floor(bytes.length / 2)), true);
    archive.end();
  });
}

describe("extractZipEntries", () => {
  it("extracts a file's bytes using only the entry's basename", () => {
    const archive = zipSync({ "nested/folder/invoice.pdf": new TextEncoder().encode("pdf-bytes") });

    const entries = extractZipEntries(archive);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.fileName).toBe("invoice.pdf");
    expect(new TextDecoder().decode(entries[0]!.bytes)).toBe("pdf-bytes");
  });

  it("filters out directory entries, macOS junk, and zero-byte entries", () => {
    const archive = zipSync({
      "folder/": new Uint8Array(0),
      "__MACOSX/invoice.pdf": new TextEncoder().encode("junk"),
      ".DS_Store": new TextEncoder().encode("junk"),
      "Thumbs.db": new TextEncoder().encode("junk"),
      "empty.txt": new Uint8Array(0),
      "real.txt": new TextEncoder().encode("kept"),
    });

    const entries = extractZipEntries(archive);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.fileName).toBe("real.txt");
  });

  it("returns an empty array for a valid, empty archive", () => {
    const archive = zipSync({});

    expect(extractZipEntries(archive)).toEqual([]);
  });

  it("throws ValidationError for a non-zip file", () => {
    const notAZip = new TextEncoder().encode("this is definitely not a zip archive");

    expect(() => extractZipEntries(notAZip)).toThrow(ValidationError);
  });

  it("throws ValidationError for an empty buffer", () => {
    expect(() => extractZipEntries(new Uint8Array(0))).toThrow(ValidationError);
  });

  it("does not reject a legitimate archive well within real plan limits", () => {
    // The largest real plan (pro) allows 50MB/file; a handful of small
    // files is exactly the realistic, legitimate case this guard must
    // never break.
    const archive = zipSync({
      "invoice-1.pdf": new Uint8Array(1024 * 1024).fill(7),
      "invoice-2.pdf": new Uint8Array(2 * 1024 * 1024).fill(9),
      "receipt.jpg": new TextEncoder().encode("small file"),
    });

    const entries = extractZipEntries(archive);

    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.fileName === "invoice-1.pdf")?.bytes.byteLength).toBe(1024 * 1024);
  });

  it(`throws ValidationError when the archive contains more than ${MAX_ZIP_ENTRIES} files`, () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i++) {
      files[`f${i}.txt`] = new Uint8Array(1);
    }
    const archive = zipSync(files);

    expect(() => extractZipEntries(archive)).toThrow(ValidationError);
  });

  // These three build and push real payloads at or near the production
  // limits (tens to low hundreds of MB) rather than mocked-down thresholds,
  // so the default test timeout is raised — the DEFLATE compression needed
  // to build the fixture, not `extractZipEntries` itself, is what's slow.
  it(
    "throws ValidationError when one entry's declared uncompressed size already exceeds the per-file limit",
    () => {
      // A highly-compressible (all-zero) buffer keeps the *compressed*
      // archive tiny and fast to build/push, while its true uncompressed
      // size genuinely exceeds the limit — the classic decompression-bomb
      // shape, at real scale, not a mocked-down threshold.
      const bomb = new Uint8Array(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1024);
      const archive = zipSync({ "bomb.bin": bomb });

      expect(() => extractZipEntries(archive)).toThrow(ValidationError);
    },
    20000,
  );

  it(
    "throws ValidationError when a real decompression bomb's true size is only discovered mid-stream (header doesn't declare it upfront)",
    async () => {
      const bomb = new Uint8Array(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1024);
      const archive = await zipWithUnknownSizes("bomb.bin", bomb);

      expect(() => extractZipEntries(archive)).toThrow(ValidationError);
    },
    20000,
  );

  it(
    "throws ValidationError when cumulative decompressed size across entries exceeds the total limit, even though each entry is within the per-file limit",
    () => {
      // 4 entries, each safely under the per-file cap on its own, whose sum
      // exceeds the total cap — proves the total-size guard is tracked
      // cumulatively across entries, not just checked per-file.
      const perEntryBytes = Math.ceil(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES / 4) + 1024;
      expect(perEntryBytes).toBeLessThan(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES);

      const archive = zipSync({
        "a.bin": new Uint8Array(perEntryBytes),
        "b.bin": new Uint8Array(perEntryBytes),
        "c.bin": new Uint8Array(perEntryBytes),
        "d.bin": new Uint8Array(perEntryBytes),
      });

      expect(() => extractZipEntries(archive)).toThrow(ValidationError);
    },
    20000,
  );
});
