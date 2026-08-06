import { z } from "zod";

export const checkoutRequestSchema = z.object({
  planId: z.enum(["basic", "pro"]),
  redirectUrl: z.string().url().optional(),
});
export type CheckoutRequestInput = z.infer<typeof checkoutRequestSchema>;

export const portalRequestSchema = z.object({
  returnUrl: z.string().url().optional(),
});
export type PortalRequestInput = z.infer<typeof portalRequestSchema>;
