import { z } from "zod";

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long."),
  organizationName: z.string().trim().min(1).max(200),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().nullable(),
});

export const authenticatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["owner", "admin", "member"]),
  organization: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
});

export const authResponseSchema = z.object({
  user: authenticatedUserSchema,
  session: authSessionSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
