import Stripe from "stripe";
import { env } from "@/config/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);

/** Maps our internal plan slugs to the Stripe Price IDs configured for them. */
export const STRIPE_PRICE_ID_BY_PLAN = {
  basic: env.STRIPE_PRICE_ID_BASIC,
  pro: env.STRIPE_PRICE_ID_PRO,
} as const;

export type PaidPlanId = keyof typeof STRIPE_PRICE_ID_BY_PLAN;
