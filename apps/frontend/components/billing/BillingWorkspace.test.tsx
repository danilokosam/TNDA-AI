import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "../../test/query-client-wrapper";
import type { PlanRow, SubscriptionResponse } from "@/types/api";

vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

// `next/navigation`'s own hooks, mocked at module level — same convention
// as features/billing/hooks.test.tsx's `mockPush`. `getSearchParams`/
// `setSearchParams` go through `vi.hoisted` so each test can control what
// `?checkout=...` the component "sees" without hitting the vi.mock hoisting
// temporal-dead-zone.
const { mockReplace, getSearchParams, setSearchParams } = vi.hoisted(() => {
  let params = new URLSearchParams();
  return {
    mockReplace: vi.fn(),
    getSearchParams: () => params,
    setSearchParams: (next: URLSearchParams) => {
      params = next;
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => getSearchParams(),
}));

const { apiFetch } = await import("@/lib/api/http");
const { BillingWorkspace } = await import("@/components/billing/BillingWorkspace");

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

const BASIC_PLAN = planFixture({ id: "basic", name: "Basic", price_monthly: 29 });
const PRO_PLAN = planFixture({ id: "pro", name: "Pro", price_monthly: 99 });
const PLANS = [planFixture(), BASIC_PLAN, PRO_PLAN];

function freeSubscriptionResponse(): SubscriptionResponse {
  return {
    plan: planFixture(),
    subscription: { status: "active", planId: "free", note: "No paid subscription on file." },
  };
}

function realSubscriptionResponse(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    plan: BASIC_PLAN,
    subscription: {
      id: "sub_1",
      organization_id: "org_1",
      plan_id: "basic",
      status: "active",
      current_period_start: "2026-08-01T00:00:00.000Z",
      current_period_end: "2026-09-01T00:00:00.000Z",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      created_at: "2026-08-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function mockApi(subscription: SubscriptionResponse, plans: PlanRow[] = PLANS) {
  vi.mocked(apiFetch).mockImplementation((path: unknown) => {
    if (path === "/api/billing/subscription") return Promise.resolve(subscription);
    if (path === "/api/billing/plans") return Promise.resolve(plans);
    throw new Error(`Unexpected path: ${String(path)}`);
  });
}

/** Same jsdom workaround as features/billing/hooks.test.tsx — see that file's doc comment. */
function stubLocationAssign() {
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  return assign;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams(new URLSearchParams());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BillingWorkspace", () => {
  it("shows a loading state before data arrives", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error state when a query fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("boom"));

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("shows the free plan with no Manage billing button and no Select buttons for the free plan", async () => {
    mockApi(freeSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(await screen.findAllByText("Free")).not.toHaveLength(0);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /select/i })).toHaveLength(2);
  });

  it("shows a real subscription with a Manage billing button and no Select buttons on any plan", async () => {
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByRole("button", { name: /manage billing/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /select/i })).not.toBeInTheDocument();
  });

  it("marks the plan matching the subscription as the current plan", async () => {
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    await screen.findByRole("button", { name: /manage billing/i });
    expect(screen.getAllByText(/current plan/i).length).toBeGreaterThan(0);
  });

  it("disables billing actions for a member role, with an explanatory message", async () => {
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="member" />, { wrapper: createQueryWrapper() });

    const button = await screen.findByRole("button", { name: /manage billing/i });
    expect(button).toBeDisabled();
    expect(screen.getAllByText(/only the organization owner can manage billing/i).length).toBeGreaterThan(0);
  });

  it("disables billing actions for an admin role (billing is owner-only)", async () => {
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="admin" />, { wrapper: createQueryWrapper() });

    const button = await screen.findByRole("button", { name: /manage billing/i });
    expect(button).toBeDisabled();
  });
});

describe("BillingWorkspace — checkout action", () => {
  it("clicking Select on a plan POSTs /api/billing/checkout with that plan's id and redirects to the returned URL", async () => {
    const user = userEvent.setup();
    const assignSpy = stubLocationAssign();
    vi.mocked(apiFetch).mockImplementation((path: unknown, _schema: unknown, init?: RequestInit) => {
      if (path === "/api/billing/subscription") return Promise.resolve(freeSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/checkout" && init?.method === "POST") {
        return Promise.resolve({ url: "https://checkout.stripe.com/session_1" });
      }
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const [basicSelect] = await screen.findAllByRole("button", { name: /select/i });

    await user.click(basicSelect!);

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.com/session_1"));
    const checkoutCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/billing/checkout")!;
    expect(JSON.parse(checkoutCall[2]?.body as string)).toEqual({ planId: "basic" });
  });

  it("disables only the clicked plan's Select button while its checkout is pending", async () => {
    const user = userEvent.setup();
    stubLocationAssign();
    let resolveCheckout!: (value: { url: string }) => void;
    vi.mocked(apiFetch).mockImplementation((path: unknown) => {
      if (path === "/api/billing/subscription") return Promise.resolve(freeSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/checkout") return new Promise((resolve) => (resolveCheckout = resolve));
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const [basicSelect, proSelect] = await screen.findAllByRole("button", { name: /select/i });

    await user.click(basicSelect!);

    await waitFor(() => expect(screen.getByRole("button", { name: /redirecting/i })).toBeDisabled());
    expect(proSelect).toBeEnabled();

    resolveCheckout({ url: "https://checkout.stripe.com/session_1" });
  });

  it("shows the checkout error only on the plan that failed, and re-enables it", async () => {
    const user = userEvent.setup();
    stubLocationAssign();
    vi.mocked(apiFetch).mockImplementation((path: unknown) => {
      if (path === "/api/billing/subscription") return Promise.resolve(freeSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/checkout") return Promise.reject(new Error("Checkout could not be started."));
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const [basicSelect] = await screen.findAllByRole("button", { name: /select/i });

    await user.click(basicSelect!);

    expect(await screen.findByText("Checkout could not be started.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /select/i })[0]).toBeEnabled());
  });
});

describe("BillingWorkspace — portal action", () => {
  it("clicking Manage billing POSTs /api/billing/portal and redirects to the returned URL", async () => {
    const user = userEvent.setup();
    const assignSpy = stubLocationAssign();
    vi.mocked(apiFetch).mockImplementation((path: unknown, _schema: unknown, init?: RequestInit) => {
      if (path === "/api/billing/subscription") return Promise.resolve(realSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/portal" && init?.method === "POST") {
        return Promise.resolve({ url: "https://billing.stripe.com/session_1" });
      }
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const manageButton = await screen.findByRole("button", { name: /manage billing/i });

    await user.click(manageButton);

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://billing.stripe.com/session_1"));
  });

  it("disables the Manage billing button and shows a pending label while the portal request is in flight", async () => {
    const user = userEvent.setup();
    stubLocationAssign();
    let resolvePortal!: (value: { url: string }) => void;
    vi.mocked(apiFetch).mockImplementation((path: unknown) => {
      if (path === "/api/billing/subscription") return Promise.resolve(realSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/portal") return new Promise((resolve) => (resolvePortal = resolve));
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const manageButton = await screen.findByRole("button", { name: /manage billing/i });

    await user.click(manageButton);

    await waitFor(() => expect(screen.getByRole("button", { name: /redirecting/i })).toBeDisabled());

    resolvePortal({ url: "https://billing.stripe.com/session_1" });
  });

  it("shows the portal error message when the request fails (e.g. no billing history yet)", async () => {
    const user = userEvent.setup();
    stubLocationAssign();
    vi.mocked(apiFetch).mockImplementation((path: unknown) => {
      if (path === "/api/billing/subscription") return Promise.resolve(realSubscriptionResponse());
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      if (path === "/api/billing/portal") {
        return Promise.reject(new Error("This organization has no billing history yet."));
      }
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    const manageButton = await screen.findByRole("button", { name: /manage billing/i });

    await user.click(manageButton);

    expect(await screen.findByText("This organization has no billing history yet.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /manage billing/i })).toBeEnabled());
  });
});

describe("BillingWorkspace — post-checkout return handling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the ?checkout query param via router.replace as soon as it's seen", async () => {
    setSearchParams(new URLSearchParams("checkout=success"));
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/billing", { scroll: false }));
  });

  it("does not call router.replace when there is no checkout param", async () => {
    mockApi(realSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    await screen.findByRole("button", { name: /manage billing/i });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows a 'finishing up' loading state (not the normal cards) immediately after a successful checkout return", async () => {
    setSearchParams(new URLSearchParams("checkout=success"));
    // Webhook hasn't landed yet — still reports the free tier on the first fetch.
    mockApi(freeSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/finishing up your subscription update/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select/i })).not.toBeInTheDocument();
  });

  it("stops polling and shows the updated subscription as soon as it reflects the new plan", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setSearchParams(new URLSearchParams("checkout=success"));
    let fetchCount = 0;
    vi.mocked(apiFetch).mockImplementation((path: unknown) => {
      if (path === "/api/billing/subscription") {
        fetchCount += 1;
        // First fetch (the immediate return-from-checkout render): webhook hasn't landed.
        // Second fetch (after one 2s poll tick): it has.
        return Promise.resolve(fetchCount === 1 ? freeSubscriptionResponse() : realSubscriptionResponse());
      }
      if (path === "/api/billing/plans") return Promise.resolve(PLANS);
      throw new Error(`Unexpected call: ${String(path)}`);
    });

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    await screen.findByText(/finishing up your subscription update/i);

    await vi.advanceTimersByTimeAsync(2000);

    expect(await screen.findByRole("button", { name: /manage billing/i })).toBeInTheDocument();
    expect(screen.queryByText(/finishing up your subscription update/i)).not.toBeInTheDocument();

    // No further polling once resolved — advancing well past the interval
    // shouldn't add more subscription fetches.
    const countAfterResolve = fetchCount;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchCount).toBe(countAfterResolve);
  });

  it("falls back to the normal view once the bounded polling window is exhausted, even if the webhook never lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setSearchParams(new URLSearchParams("checkout=success"));
    // Webhook never lands — every fetch still reports the free tier.
    mockApi(freeSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });
    await screen.findByText(/finishing up your subscription update/i);

    await vi.advanceTimersByTimeAsync(20_000);

    await waitFor(() => expect(screen.queryByText(/finishing up your subscription update/i)).not.toBeInTheDocument());
    // Falls back to the normal (still-free) view, not an infinite spinner.
    expect(screen.getAllByRole("button", { name: /select/i }).length).toBeGreaterThan(0);
  });

  it("shows a non-destructive 'checkout cancelled' notice and the normal view immediately, with no polling", async () => {
    setSearchParams(new URLSearchParams("checkout=cancelled"));
    mockApi(freeSubscriptionResponse());

    render(<BillingWorkspace role="owner" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText(/checkout was cancelled/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /select/i }).length).toBeGreaterThan(0);
  });
});
