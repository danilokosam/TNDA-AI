import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/utils/errors";

vi.mock("@/config/supabase", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

const { supabaseAdmin } = await import("@/config/supabase");
const billingRepository = await import("@/modules/billing/billing.repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * A minimal fake of Supabase's fluent query builder (`.from().select()
 * .eq().single()`, etc.). Each chain method returns the same object, and
 * the object is itself thenable so `await` resolves to `result` no matter
 * which method was called last — matching how the real PostgREST builder
 * behaves. Typed as `any` deliberately (see eslint.config.js's `**\/*.test.ts`
 * override): the real builder's type has 6+ generic parameters per
 * method, and faking that shape exactly isn't practical or meaningful for
 * a test double.
 */
function createQueryBuilderMock(result: QueryResult) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    single: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then: (onfulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setOrganizationStripeCustomerId", () => {
  it("updates organizations.stripe_customer_id by id", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await billingRepository.setOrganizationStripeCustomerId("org_1", "cus_1");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("organizations");
    expect(chain.update).toHaveBeenCalledWith({ stripe_customer_id: "cus_1" });
    expect(chain.eq).toHaveBeenCalledWith("id", "org_1");
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(billingRepository.setOrganizationStripeCustomerId("org_1", "cus_1")).rejects.toThrow(AppError);
  });
});

describe("getOrganizationStripeLink", () => {
  it("returns the organization's stripe_customer_id when found", async () => {
    const chain = createQueryBuilderMock({ data: { id: "org_1", stripe_customer_id: "cus_1" }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const link = await billingRepository.getOrganizationStripeLink("org_1");

    expect(link).toEqual({ organizationId: "org_1", stripeCustomerId: "cus_1" });
  });

  it("returns a null stripeCustomerId when the org has never checked out", async () => {
    const chain = createQueryBuilderMock({ data: { id: "org_1", stripe_customer_id: null }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const link = await billingRepository.getOrganizationStripeLink("org_1");

    expect(link.stripeCustomerId).toBeNull();
  });

  it("throws AppError when the organization isn't found", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(billingRepository.getOrganizationStripeLink("missing_org")).rejects.toThrow(AppError);
  });
});

describe("findOrganizationIdByStripeCustomerId", () => {
  it("returns the organization id when a match exists", async () => {
    const chain = createQueryBuilderMock({ data: { id: "org_1" }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(billingRepository.findOrganizationIdByStripeCustomerId("cus_1")).resolves.toBe("org_1");
    expect(chain.eq).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
  });

  it("returns null when no organization matches", async () => {
    const chain = createQueryBuilderMock({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(billingRepository.findOrganizationIdByStripeCustomerId("cus_unknown")).resolves.toBeNull();
  });

  it("throws AppError when Supabase returns an error", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "db exploded" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(billingRepository.findOrganizationIdByStripeCustomerId("cus_1")).rejects.toThrow(AppError);
  });
});

describe("upsertSubscriptionFromStripe", () => {
  const row = {
    id: "row_1",
    organization_id: "org_1",
    plan_id: "basic",
    status: "active",
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-02-01T00:00:00.000Z",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("upserts by stripe_subscription_id and returns the row", async () => {
    const chain = createQueryBuilderMock({ data: row, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    const result = await billingRepository.upsertSubscriptionFromStripe({
      organizationId: "org_1",
      planId: "basic",
      status: "active",
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });

    expect(result).toEqual(row);
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_subscription_id: "sub_1", plan_id: "basic" }),
      { onConflict: "stripe_subscription_id" },
    );
  });

  it("throws AppError when the upsert fails", async () => {
    const chain = createQueryBuilderMock({ data: null, error: { message: "conflict" } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await expect(
      billingRepository.upsertSubscriptionFromStripe({
        organizationId: "org_1",
        planId: "basic",
        status: "active",
        currentPeriodStart: "2026-01-01T00:00:00.000Z",
        currentPeriodEnd: "2026-02-01T00:00:00.000Z",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrow(AppError);
  });
});
