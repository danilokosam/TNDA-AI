import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { storage: { from: vi.fn() } },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const { buildStoragePath, uploadDocumentFile, createSignedPreviewUrl, deleteDocumentFile, downloadDocumentFile } =
  await import("@/services/storage.service");

function mockBucket(
  overrides: Partial<Record<"upload" | "createSignedUrl" | "remove" | "download", ReturnType<typeof vi.fn>>> = {},
) {
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
    ...overrides,
  };
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue(bucket as never);
  return bucket;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildStoragePath", () => {
  it("builds an org-scoped, job-scoped path", () => {
    expect(buildStoragePath("org_1", "job_1", "invoice.pdf")).toBe("org_1/job_1/invoice.pdf");
  });
});

describe("uploadDocumentFile", () => {
  it("uploads to the configured bucket with the given content type, never overwriting an existing object", async () => {
    const bucket = mockBucket();
    const bytes = new Uint8Array([1, 2, 3]);

    await uploadDocumentFile("org_1/job_1/invoice.pdf", bytes, "application/pdf");

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("documents");
    expect(bucket.upload).toHaveBeenCalledWith("org_1/job_1/invoice.pdf", bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  });

  it("throws AppError when Supabase Storage returns an error", async () => {
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: "bucket not found" } }) });

    await expect(uploadDocumentFile("org_1/job_1/x.pdf", new Uint8Array(), "application/pdf")).rejects.toThrow(
      /Failed to store/,
    );
  });
});

describe("createSignedPreviewUrl", () => {
  it("requests a signed URL with the given expiry and returns it", async () => {
    const bucket = mockBucket();

    const url = await createSignedPreviewUrl("org_1/job_1/invoice.pdf", 1800);

    expect(bucket.createSignedUrl).toHaveBeenCalledWith("org_1/job_1/invoice.pdf", 1800);
    expect(url).toBe("https://signed.example/x");
  });

  it("defaults the expiry to one hour when not specified", async () => {
    const bucket = mockBucket();

    await createSignedPreviewUrl("org_1/job_1/invoice.pdf");

    expect(bucket.createSignedUrl).toHaveBeenCalledWith("org_1/job_1/invoice.pdf", 3600);
  });

  it("throws AppError when Supabase Storage returns an error", async () => {
    mockBucket({ createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: { message: "object not found" } }) });

    await expect(createSignedPreviewUrl("org_1/job_1/missing.pdf")).rejects.toThrow(/Failed to create/);
  });
});

describe("downloadDocumentFile", () => {
  it("downloads the object and returns its bytes", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const bucket = mockBucket({ download: vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }) });

    const result = await downloadDocumentFile("org_1/job_1/invoice.pdf");

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("documents");
    expect(bucket.download).toHaveBeenCalledWith("org_1/job_1/invoice.pdf");
    expect(result).toEqual(bytes);
  });

  it("throws AppError when Supabase Storage returns an error", async () => {
    mockBucket({ download: vi.fn().mockResolvedValue({ data: null, error: { message: "object not found" } }) });

    await expect(downloadDocumentFile("org_1/job_1/missing.pdf")).rejects.toThrow(/Failed to download/);
  });
});

describe("deleteDocumentFile", () => {
  it("removes the object at the given path", async () => {
    const bucket = mockBucket();

    await deleteDocumentFile("org_1/job_1/invoice.pdf");

    expect(bucket.remove).toHaveBeenCalledWith(["org_1/job_1/invoice.pdf"]);
  });

  it("throws AppError when Supabase Storage returns an error", async () => {
    mockBucket({ remove: vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } }) });

    await expect(deleteDocumentFile("org_1/job_1/invoice.pdf")).rejects.toThrow(/Failed to delete/);
  });
});
