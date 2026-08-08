import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { PlanRow, SubscriptionResponse } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

// Same mocking shape as DocumentResultsView.test.tsx's own precedent — a
// module-level spy so "does this hook use the router" is asserted the
// same way elsewhere in this codebase, not a new pattern.
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const { apiFetch } = await import("@/lib/api/http");
const { usePlans, useSubscription, useCreateCheckoutSession, useCreatePortalSession } = await import(
  "@/features/billing/hooks"
);

function planFixture(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "free",
    name: "Free",
    price_monthly: 0,
    max_documents_per_month: 5,
    max_pages_per_document: 1,
    max_pages_per_month: 2,
    max_file_size_mb: 5,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function subscriptionResponseFixture(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    plan: planFixture(),
    subscription: { status: "active", planId: "free", note: "No paid subscription on file." },
    ...overrides,
  };
}

/**
 * jsdom's `window.location.assign` is a non-configurable property —
 * `vi.spyOn(window.location, "assign")` throws "Cannot redefine
 * property." `vi.stubGlobal` replaces the whole global cleanly instead,
 * which is vitest's own documented way around exactly this jsdom
 * limitation; `vi.unstubAllGlobals()` below restores the real one after
 * each test so this doesn't leak into other test files.
 */
function stubLocationAssign() {
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  return assign;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePlans", () => {
  it("fetches /api/billing/plans", async () => {
    const plans = [planFixture()];
    vi.mocked(apiFetch).mockResolvedValue(plans);

    const { result } = renderHook(() => usePlans(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(plans));
    expect(apiFetch).toHaveBeenCalledWith("/api/billing/plans", expect.anything());
  });

  it("exposes a loading state before the fetch resolves", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => usePlans(), { wrapper: createQueryWrapper() });

    expect(result.current.isPending).toBe(true);
  });

  it("exposes the error when the fetch fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => usePlans(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useSubscription", () => {
  it("fetches /api/billing/subscription", async () => {
    const response = subscriptionResponseFixture();
    vi.mocked(apiFetch).mockResolvedValue(response);

    const { result } = renderHook(() => useSubscription(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(apiFetch).toHaveBeenCalledWith("/api/billing/subscription", expect.anything());
  });

  it("exposes a loading state before the fetch resolves", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useSubscription(), { wrapper: createQueryWrapper() });

    expect(result.current.isPending).toBe(true);
  });

  it("exposes the error when the fetch fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useSubscription(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("accepts a refetchInterval option, so the post-checkout return flow can enable bounded polling without a new polling module", async () => {
    vi.mocked(apiFetch).mockResolvedValue(subscriptionResponseFixture());

    renderHook(() => useSubscription({ refetchInterval: 2000 }), { wrapper: createQueryWrapper() });

    // Nothing to assert beyond "it renders and fetches without error" here —
    // the actual interval *behavior* (stopping on update / at the bound) is
    // Step 6's concern, tested where the bounded-window logic itself lives.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  });
});

describe("useCreateCheckoutSession", () => {
  it("POSTs /api/billing/checkout with the given planId", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });
    stubLocationAssign();

    const { result } = renderHook(() => useCreateCheckoutSession(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync({ planId: "basic" });

    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/billing/checkout");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ planId: "basic" });
  });

  it("navigates to the returned Stripe URL via window.location, not the Next.js router", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://checkout.stripe.com/session_1" });
    const assignSpy = stubLocationAssign();

    const { result } = renderHook(() => useCreateCheckoutSession(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync({ planId: "basic" });

    expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.com/session_1");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("exposes a pending state while the mutation is in flight", async () => {
    let resolveFetch!: (value: { url: string }) => void;
    vi.mocked(apiFetch).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    stubLocationAssign();

    const { result } = renderHook(() => useCreateCheckoutSession(), { wrapper: createQueryWrapper() });
    expect(result.current.isPending).toBe(false);

    const promise = result.current.mutateAsync({ planId: "basic" });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    resolveFetch({ url: "https://checkout.stripe.com/session_1" });
    await promise;
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("exposes the error and does not navigate when the request fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("checkout failed"));
    const assignSpy = stubLocationAssign();

    const { result } = renderHook(() => useCreateCheckoutSession(), { wrapper: createQueryWrapper() });
    await expect(result.current.mutateAsync({ planId: "basic" })).rejects.toThrow("checkout failed");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("useCreatePortalSession", () => {
  it("POSTs /api/billing/portal with no body", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });
    stubLocationAssign();

    const { result } = renderHook(() => useCreatePortalSession(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync();

    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/billing/portal");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("navigates to the returned Stripe URL via window.location, not the Next.js router", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ url: "https://billing.stripe.com/session_1" });
    const assignSpy = stubLocationAssign();

    const { result } = renderHook(() => useCreatePortalSession(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync();

    expect(assignSpy).toHaveBeenCalledWith("https://billing.stripe.com/session_1");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("exposes the error and does not navigate when the request fails (e.g. no billing history yet)", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("This organization has no billing history yet."));
    const assignSpy = stubLocationAssign();

    const { result } = renderHook(() => useCreatePortalSession(), { wrapper: createQueryWrapper() });
    await expect(result.current.mutateAsync()).rejects.toThrow("no billing history");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
