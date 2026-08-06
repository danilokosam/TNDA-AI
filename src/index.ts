import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { env } from "@/config/env";
import { errorMiddleware } from "@/middlewares/error.middleware";
import { rateLimitMiddleware } from "@/middlewares/rate-limit.middleware";
import { authRoutes } from "@/modules/auth/auth.routes";
import { organizationRoutes } from "@/modules/organization/organization.routes";
import { billingRoutes } from "@/modules/billing/billing.routes";
import { documentsRoutes } from "@/modules/documents/documents.routes";

const app = new Elysia()
  .use(errorMiddleware)
  .use(cors({ origin: env.CORS_ORIGINS }))
  .use(swagger({ path: "/docs", documentation: { info: { title: "TNDA-AI API", version: "0.1.0" } } }))
  .use(rateLimitMiddleware)
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .use(authRoutes)
  .use(organizationRoutes)
  .use(billingRoutes)
  .use(documentsRoutes)
  .listen(env.PORT);

console.log(
  `TNDA-AI backend listening on http://localhost:${env.PORT} (${env.NODE_ENV}) — docs at /docs`,
);

export type App = typeof app;
