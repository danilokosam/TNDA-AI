import type { ReactNode } from "react";
import { RouteTransition } from "@/components/layout/RouteTransition";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <RouteTransition>{children}</RouteTransition>
      </div>
    </div>
  );
}
