import { Elysia } from "elysia";
import { authMiddleware } from "@/middlewares/auth.middleware";
import * as authService from "@/modules/auth/auth.service";
import { loginSchema, signUpSchema } from "@/modules/auth/auth.schema";

export const authRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .post(
    "/signup",
    async ({ body, set }) => {
      const result = await authService.signUp(body);
      set.status = 201;
      return result;
    },
    { body: signUpSchema },
  )
  .post(
    "/login",
    async ({ body }) => authService.login(body),
    { body: loginSchema },
  )
  .use(authMiddleware)
  .get("/me", async ({ auth }) => authService.getCurrentUser(auth.userId));
