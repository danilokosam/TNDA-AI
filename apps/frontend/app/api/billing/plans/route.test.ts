// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/billing.service", () => ({
  getPlans: vi.fn(),
}));

const billingService = await import("@/services/billing.service");
const { GET } = await import("@/app/api/billing/plans/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/billing/plans", () => {
  it("returns the service's plan list unchanged", async () => {
    const plans = [{ id: "free" }, { id: "basic" }];
    vi.mocked(billingService.getPlans).mockResolvedValue(plans as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plans);
  });

  it("translates a thrown service error into the uniform error envelope", async () => {
    const { ApiError } = await import("@/lib/api/response");
    vi.mocked(billingService.getPlans).mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "No session."));

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
