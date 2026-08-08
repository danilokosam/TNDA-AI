import type { Metadata } from "next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { getCurrentUser } from "@/services/auth.service";
import { getOrganizationOverview } from "@/services/organization.service";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

/**
 * A Server Component fetching directly via `services/*`, same pattern as
 * `DashboardPage` — nothing here is client-interactive, so no BFF route or
 * hook is needed. Strictly read-only: no organization rename, no team
 * management, no password/email self-service — none of that has any
 * backend support yet.
 */
export default async function SettingsPage() {
  const [user, { organization }] = await Promise.all([getCurrentUser(), getOrganizationOverview()]);

  return (
    <>
      <PageHeader title="Settings" description="Organization details and preferences." />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{user.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <p className="text-sm font-medium capitalize">{user.role}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{organization.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm font-medium">{formatDate(organization.created_at)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
