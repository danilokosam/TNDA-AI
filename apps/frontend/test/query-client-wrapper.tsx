import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** A fresh, retry-disabled QueryClient per call — for `renderHook`'s `wrapper` option in tests. */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
