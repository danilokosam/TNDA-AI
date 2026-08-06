import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as billingService from "@/modules/billing/billing.service";

export const billingRoutes = new Elysia({ prefix: "/api/v1/billing" })
  .use(authMiddleware)
  .get("/plans", async () => billingService.listAvailablePlans())
  .get("/subscription", async ({ auth }) => billingService.getCurrentSubscription(auth.organizationId));
