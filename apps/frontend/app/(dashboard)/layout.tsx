import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RouteTransition } from "@/components/layout/RouteTransition";
import { getCurrentUser } from "@/services/auth.service";

/**
 * Fetches the current user once, here, and passes it down as a prop —
 * deliberately not a client-side query + HydrationBoundary yet. Nothing in
 * the shell needs to independently refetch this on the client in Stage 1;
 * that pattern is worth introducing once something actually does (e.g. a
 * client mutation that should invalidate usage numbers after an upload).
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <TopBar />
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <RouteTransition>{children}</RouteTransition>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
