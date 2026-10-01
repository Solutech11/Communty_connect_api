import { z } from "zod";

export const roommateOptions = {
  housingMode: ["seeking", "hosting"],
  gender: ["woman", "man", "non_binary", "undisclosed"],
  cleanliness: ["relaxed", "balanced", "very_tidy"],
  sleepSchedule: ["early", "flexible", "late"],
  guests: ["rarely", "sometimes", "often"],
  socialPreference: ["quiet", "balanced", "social"],
} as const;

const money = z.number().int().min(0).max(1_000_000_000_000);
const area = z.string().trim().min(2).max(100);
export const roommateProfileFields = z.object({
  adultConfirmed: z.literal(true),
  housingMode: z.enum(roommateOptions.housingMode),
  state: area,
  lgas: z.array(area).min(1).max(10).transform((values) => [...new Set(values)]),
  minAnnualRentKobo: money,
  maxAnnualRentKobo: money.positive(),
  moveInFrom: z.iso.date(),
  moveInTo: z.iso.date(),
  gender: z.enum(roommateOptions.gender).default("undisclosed"),
  acceptableGenders: z.array(z.enum(roommateOptions.gender)).min(1).max(4)
    .default([...roommateOptions.gender]),
  cleanliness: z.enum(roommateOptions.cleanliness),
  sleepSchedule: z.enum(roommateOptions.sleepSchedule),
  guests: z.enum(roommateOptions.guests),
  socialPreference: z.enum(roommateOptions.socialPreference),
  smokes: z.boolean(),
  acceptsSmoking: z.boolean(),
  hasPets: z.boolean(),
  acceptsPets: z.boolean(),
  description: z.string().trim().max(500).default(""),
}).strict();

const ordered = (value: Partial<z.infer<typeof roommateProfileFields>>) =>
  (value.minAnnualRentKobo === undefined || value.maxAnnualRentKobo === undefined
    || value.minAnnualRentKobo <= value.maxAnnualRentKobo)
  && (!value.moveInFrom || !value.moveInTo || value.moveInFrom <= value.moveInTo)
  && (value.housingMode !== "hosting" || !value.lgas || value.lgas.length === 1);

export const completeRoommateProfileSchema = roommateProfileFields.refine(ordered, {
  message: "Rent and move-in ranges must be ordered; hosts must select exactly one LGA",
});
export const roommateDraftSchema = roommateProfileFields.partial().refine(ordered, {
  message: "Rent and move-in ranges must be ordered; hosts must select exactly one LGA",
});
export type RoommateAnswers = z.infer<typeof roommateProfileFields>;

export const roommatePageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const contactConsentSchema = z.object({
  fields: z.array(z.enum(["phone", "email"])).min(1).max(2)
    .transform((values) => [...new Set(values)]),
}).strict();
