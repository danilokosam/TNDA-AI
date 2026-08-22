import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrentSubscriptionCard } from "@/components/billing/CurrentSubscriptionCard";
import type { PlanRow } from "@/types/api";

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

describe("CurrentSubscriptionCard", () => {
  it("shows the plan name and an 'Active' badge for the free tier", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture()}
        status="active"
        hasStripeSubscription={false}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={false}
      />,
    );

    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows a 'Trialing' badge for a trialing subscription", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "basic", name: "Basic", price_monthly: 29 })}
        status="trialing"
        hasStripeSubscription={true}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={false}
      />,
    );

    expect(screen.getByText("Trialing")).toBeInTheDocument();
  });

  it("shows a 'Past due' badge and a payment warning for a past_due subscription", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "pro", name: "Pro", price_monthly: 99 })}
        status="past_due"
        hasStripeSubscription={true}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={false}
      />,
    );

    expect(screen.getByText("Past due")).toBeInTheDocument();
    expect(screen.getByText(/payment needs attention/i)).toBeInTheDocument();
  });

  it("does not show a Manage billing button for the implicit free tier (no Stripe customer yet)", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture()}
        status="active"
        hasStripeSubscription={false}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
  });

  it("shows an enabled Manage billing button for an owner/admin with a real subscription", async () => {
    const user = userEvent.setup();
    const onManagePortal = vi.fn();
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "basic", name: "Basic", price_monthly: 29 })}
        status="active"
        hasStripeSubscription={true}
        canManageBilling={true}
        onManagePortal={onManagePortal}
        isPortalPending={false}
      />,
    );

    const button = screen.getByRole("button", { name: /manage billing/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onManagePortal).toHaveBeenCalledOnce();
  });

  it("disables the Manage billing button for a member, with an explanatory caption", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "basic", name: "Basic", price_monthly: 29 })}
        status="active"
        hasStripeSubscription={true}
        canManageBilling={false}
        onManagePortal={vi.fn()}
        isPortalPending={false}
      />,
    );

    expect(screen.getByRole("button", { name: /manage billing/i })).toBeDisabled();
    expect(screen.getByText(/only the organization owner can manage billing/i)).toBeInTheDocument();
  });

  it("disables the Manage billing button and shows a pending label while the portal mutation is in flight", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "basic", name: "Basic", price_monthly: 29 })}
        status="active"
        hasStripeSubscription={true}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={true}
      />,
    );

    expect(screen.getByRole("button", { name: /redirecting/i })).toBeDisabled();
  });

  it("shows the portal error message when one is given", () => {
    render(
      <CurrentSubscriptionCard
        plan={planFixture({ id: "basic", name: "Basic", price_monthly: 29 })}
        status="active"
        hasStripeSubscription={true}
        canManageBilling={true}
        onManagePortal={vi.fn()}
        isPortalPending={false}
        portalError="Something went wrong."
      />,
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});
