import { z } from "zod";

/** Bounds how far back `since` can go — a client bug (or a malicious
 * authenticated caller) sending an ancient date shouldn't make the
 * per-day series generation loop over years of dates. */
const MAX_STATS_WINDOW_DAYS = 400;

export const jobStatsQuerySchema = z.object({
  since: z
    .string()
    .datetime()
    .refine(
      (value) => {
        const days = (Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24);
        return days >= 0 && days <= MAX_STATS_WINDOW_DAYS;
      },
      { message: `since must be within the last ${MAX_STATS_WINDOW_DAYS} days and not in the future.` },
    )
    .optional(),
});
export type JobStatsQuery = z.infer<typeof jobStatsQuerySchema>;
