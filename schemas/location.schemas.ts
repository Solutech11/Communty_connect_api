import { z } from "zod";

const queryNumber = (minimum: number, maximum: number) => z.string()
  .trim()
  .regex(/^-?(?:\d+\.?\d*|\.\d+)$/, "Must be a number")
  .transform(Number)
  .pipe(z.number().finite().min(minimum).max(maximum));

export const locationSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  countryCode: z.string().regex(/^[a-zA-Z]{2}$/).transform((code) => code.toUpperCase()).optional(),
  latitude: queryNumber(-90, 90).optional(),
  longitude: queryNumber(-180, 180).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().finite())
    .transform((value) => Math.min(value, 8)).default(8),
}).strict().refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: "Latitude and longitude must be supplied together", path: ["latitude"] },
);

export type LocationSearchQuery = z.infer<typeof locationSearchQuerySchema>;
