import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanCard } from "@/components/billing/PlanCard";
import type { PlanRow } from "@/types/api";

function planFixture(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "basic",
    name: "Basic",
    price_monthly: 29,
    max_documents_per_month: 50,
    max_pages_per_document: 20,
    max_pages_per_month: 500,
    max_file_size_mb: 25,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PlanCard", () => {
  it("renders the plan name and formatted monthly price", () => {
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={false}
      />,
    );

    expect(screen.getByText("Basic")).toBeInTheDocument();
    expect(screen.getByText("$29/mo")).toBeInTheDocument();
  });

  it("shows a 'Current plan' indicator and no Select button when this is the current plan", () => {
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={true}
        hasActiveSubscription={true}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={false}
      />,
    );

    expect(screen.getByText(/current plan/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select/i })).not.toBeInTheDocument();
  });

  it("shows no Select button for the free plan", () => {
    render(
      <PlanCard
        plan={planFixture({ id: "free", name: "Free", price_monthly: 0 })}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /select/i })).not.toBeInTheDocument();
  });

  it("shows no Select button for a non-current paid plan when the org already has an active subscription (manage via Portal instead)", () => {
    render(
      <PlanCard
        plan={planFixture({ id: "pro", name: "Pro", price_monthly: 99 })}
        isCurrentPlan={false}
        hasActiveSubscription={true}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /select/i })).not.toBeInTheDocument();
  });

  it("shows an enabled Select button when eligible for checkout and calls onSelect when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={true}
        onSelect={onSelect}
        isCheckoutPending={false}
      />,
    );

    const button = screen.getByRole("button", { name: /select/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("disables the Select button for a member, with an explanatory caption", () => {
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={false}
        onSelect={vi.fn()}
        isCheckoutPending={false}
      />,
    );

    expect(screen.getByRole("button", { name: /select/i })).toBeDisabled();
    expect(screen.getByText(/only the organization owner can manage billing/i)).toBeInTheDocument();
  });

  it("disables the Select button and shows a pending label while checkout is in flight", () => {
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={true}
      />,
    );

    expect(screen.getByRole("button", { name: /redirecting/i })).toBeDisabled();
  });

  it("shows the checkout error message when one is given", () => {
    render(
      <PlanCard
        plan={planFixture()}
        isCurrentPlan={false}
        hasActiveSubscription={false}
        canManageBilling={true}
        onSelect={vi.fn()}
        isCheckoutPending={false}
        checkoutError="Something went wrong."
      />,
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});
