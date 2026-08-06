import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as organizationService from "@/modules/organization/organization.service";
import { jobStatsQuerySchema } from "@/modules/organization/organization.schema";

export const organizationRoutes = new Elysia({ prefix: "/api/v1/organizations" })
  .use(authMiddleware)
  .get("/me", async ({ auth }) => organizationService.getOrganizationOverview(auth.organizationId))
  .get("/me/usage", async ({ auth }) => organizationService.getUsageSummary(auth.organizationId))
  .get(
    "/me/stats",
    async ({ auth, query }) => organizationService.getJobStats(auth.organizationId, query.since),
    { query: jobStatsQuerySchema },
  );
