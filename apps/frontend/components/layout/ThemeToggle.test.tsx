import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSetTheme = vi.fn();
let mockTheme = "system";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

const { ThemeToggle } = await import("@/components/layout/ThemeToggle");

beforeEach(() => {
  vi.clearAllMocks();
  mockTheme = "system";
});

describe("ThemeToggle", () => {
  it("renders a trigger button for changing the theme", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: /change theme/i })).toBeInTheDocument();
  });

  it("opens a menu with Light, Dark, and System options", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /change theme/i }));

    expect(screen.getByRole("menuitemradio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /system/i })).toBeInTheDocument();
  });

  it("marks the currently active preference as checked", async () => {
    mockTheme = "dark";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /change theme/i }));

    expect(screen.getByRole("menuitemradio", { name: /dark/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /light/i })).toHaveAttribute("aria-checked", "false");
  });

  it("calls setTheme('light') when Light is selected", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /change theme/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /light/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("calls setTheme('dark') when Dark is selected", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /change theme/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /dark/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme('system') when System is selected", async () => {
    mockTheme = "light";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /change theme/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /system/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });
});
