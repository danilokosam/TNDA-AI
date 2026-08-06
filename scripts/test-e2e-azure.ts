import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

/**
 * Live end-to-end test of the full document-processing pipeline, run
 * against a real Azure Document Intelligence resource:
 *
 *   signup/login -> generate a mock invoice PDF -> upload it through the
 *   real HTTP API (multipart, auth, pre-flight quota checks and all) ->
 *   poll the job until Azure reports a terminal state -> print the result.
 *
 * This spawns its own instance of the app (on a dedicated port, isolated
 * from any `bun run dev` you might already have running) so the whole
 * request/response cycle — including auth middleware and multipart
 * parsing — is exercised exactly as a real client would.
 *
 * Requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/API_KEY and Supabase
 * credentials already configured in `.env`.
 */

const TEST_PORT = 3999;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const PROJECT_ROOT = join(import.meta.dir, "..");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await sleep(300);
  }

  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

async function describeError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(body);
    return parsed.success ? `${parsed.data.error.code}: ${parsed.data.error.message}` : JSON.stringify(body);
  } catch {
    return response.statusText;
  }
}

const authResultSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }),
  }),
  session: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number().nullable(),
  }),
});
type AuthResult = z.infer<typeof authResultSchema>;

async function signUpOrLogIn(email: string, password: string, organizationName: string): Promise<AuthResult> {
  const signUpResponse = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, organizationName }),
  });

  if (signUpResponse.ok) {
    return authResultSchema.parse(await signUpResponse.json());
  }

  if (signUpResponse.status === 409) {
    console.log(`[e2e] "${email}" already exists — logging in instead`);
    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!loginResponse.ok) {
      throw new Error(`login failed: ${await describeError(loginResponse)}`);
    }
    return authResultSchema.parse(await loginResponse.json());
  }

  throw new Error(`signup failed (${signUpResponse.status}): ${await describeError(signUpResponse)}`);
}

async function createMockInvoicePdf(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let cursorY = 740;
  const writeLine = (text: string, size = 12, bold = false): void => {
    page.drawText(text, { x: 50, y: cursorY, size, font: bold ? boldFont : font, color: rgb(0, 0, 0) });
    cursorY -= size + 10;
  };

  writeLine("INVOICE", 22, true);
  writeLine("Invoice Number: INV-2026-0001");
  writeLine("Invoice Date: 2026-08-06");
  writeLine("Due Date: 2026-09-05");
  cursorY -= 10;
  writeLine("Bill To:", 12, true);
  writeLine("Acme Test Company, 123 Example Street, Testville, TX 00000");
  cursorY -= 10;
  writeLine("Vendor:", 12, true);
  writeLine("TNDA-AI E2E Test Vendor Inc.");
  cursorY -= 10;
  writeLine("Description            Qty   Unit Price   Amount", 11, true);
  writeLine("Widget A                2      $25.00       $50.00");
  writeLine("Widget B                1      $50.00       $50.00");
  cursorY -= 10;
  writeLine("Subtotal: $100.00");
  writeLine("Tax: $0.00");
  writeLine("Total Due: $100.00", 14, true);

  return pdfDoc.save();
}

const jobDtoSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  pageCount: z.number().nullable(),
  resultJson: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type JobDto = z.infer<typeof jobDtoSchema>;

const uploadResponseSchema = z.union([
  z.object({ kind: z.literal("single"), job: jobDtoSchema }),
  z.object({ kind: z.literal("batch"), batch: z.unknown() }),
]);

async function uploadDocument(accessToken: string, pdfBytes: Uint8Array): Promise<JobDto> {
  const file = new File([pdfBytes], "e2e-test-invoice.pdf", { type: "application/pdf" });
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${BASE_URL}/api/v1/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`upload failed (${response.status}): ${await describeError(response)}`);
  }

  const parsed = uploadResponseSchema.parse(await response.json());
  if (parsed.kind !== "single") {
    throw new Error("expected a single-file job response, got a batch response");
  }
  return parsed.job;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "rejected_quota"]);
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60; // ~2 minutes

async function pollJobUntilTerminal(accessToken: string, jobId: string): Promise<JobDto> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${BASE_URL}/api/v1/documents/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`poll failed (${response.status}): ${await describeError(response)}`);
    }

    const job = jobDtoSchema.parse(await response.json());
    console.log(`[e2e] poll #${attempt}: status=${job.status}`);

    if (TERMINAL_STATUSES.has(job.status)) {
      return job;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`job did not reach a terminal state within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function main(): Promise<void> {
  console.log(`[e2e] spawning server on ${BASE_URL} ...`);
  const server = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: PROJECT_ROOT,
    env: { ...Bun.env, PORT: String(TEST_PORT) },
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await waitForHealth(20_000);
    console.log("[e2e] server is healthy");

    const email = `e2e-test-${Date.now()}@example.com`;
    const password = "E2eTestPassword123!";
    const organizationName = "E2E Test Org";

    console.log(`[e2e] signing up test user ${email} ...`);
    const auth = await signUpOrLogIn(email, password, organizationName);
    console.log(`[e2e] authenticated as ${auth.user.email} (org: ${auth.user.organization.name})`);

    console.log("[e2e] generating mock invoice PDF ...");
    const pdfBytes = await createMockInvoicePdf();
    console.log(`[e2e] generated PDF (${pdfBytes.byteLength} bytes)`);

    console.log("[e2e] uploading document ...");
    const uploadedJob = await uploadDocument(auth.session.accessToken, pdfBytes);
    console.log(`[e2e] upload accepted: jobId=${uploadedJob.jobId} status=${uploadedJob.status}`);

    console.log("[e2e] polling job status until terminal ...");
    const finalJob = await pollJobUntilTerminal(auth.session.accessToken, uploadedJob.jobId);

    console.log(`[e2e] job reached terminal status: ${finalJob.status}`);
    console.log("[e2e] full job payload:");
    console.log(JSON.stringify(finalJob, null, 2));

    if (finalJob.status !== "completed") {
      throw new Error(
        `job did not complete successfully (status=${finalJob.status}, error=${finalJob.errorMessage ?? "none"})`,
      );
    }

    console.log("[e2e] SUCCESS — end-to-end Azure Document Intelligence pipeline verified.");
  } finally {
    console.log("[e2e] shutting down test server ...");
    server.kill();
    await server.exited;
  }
}

main().catch((error: unknown) => {
  console.error("[e2e] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
