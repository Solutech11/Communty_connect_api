import type { RoommateAnswers } from "../schemas/roommate.schemas";

const normalize = (value: string): string => value.trim().toLowerCase();
const intersection = (left: readonly string[], right: readonly string[]): string[] => {
  const rightSet = new Set(right.map(normalize));
  return [...new Set(left.map(normalize))].filter((value) => rightSet.has(value));
};

export const roommatesCoreCompatible = (left: RoommateAnswers, right: RoommateAnswers): boolean => {
  return left.adultConfirmed && right.adultConfirmed
    && !(left.housingMode === "hosting" && right.housingMode === "hosting")
    && left.acceptableGenders.includes(right.gender) && right.acceptableGenders.includes(left.gender)
    && (!left.smokes || right.acceptsSmoking) && (!right.smokes || left.acceptsSmoking)
    && (!left.hasPets || right.acceptsPets) && (!right.hasPets || left.acceptsPets);
};

export const roommatesCompatible = (left: RoommateAnswers, right: RoommateAnswers): boolean => {
  return roommatesCoreCompatible(left, right)
    && normalize(left.state) === normalize(right.state)
    && intersection(left.lgas, right.lgas).length > 0
    && Math.max(left.minAnnualRentKobo, right.minAnnualRentKobo)
      <= Math.min(left.maxAnnualRentKobo, right.maxAnnualRentKobo)
    && left.moveInFrom <= right.moveInTo && right.moveInFrom <= left.moveInTo;
};

export const selectCompatibleOrAvailableRoommates = <T>(
  owner: RoommateAnswers,
  available: readonly T[],
  answersFor: (candidate: T) => RoommateAnswers,
): { candidates: T[]; usedFallback: boolean } => {
  const compatible = available.filter((candidate) => roommatesCoreCompatible(owner, answersFor(candidate)));
  if (compatible.length) return { candidates: compatible, usedFallback: false };
  return { candidates: [...available], usedFallback: available.length > 0 };
};

export const intervalOverlap = (a: number, b: number, c: number, d: number): number => {
  // Treat an agreed single point as compatible instead of dividing by zero.
  if (Math.max(a, c) > Math.min(b, d)) return 0;
  if (a === b || c === d) return 1;
  return (Math.min(b, d) - Math.max(a, c)) / (Math.max(b, d) - Math.min(a, c));
};

export const roommateScore = (
  left: RoommateAnswers,
  right: RoommateAnswers,
  leftTags: readonly string[],
  rightTags: readonly string[],
): { score: number; reasons: string[] } => {
  const habits = ["cleanliness", "sleepSchedule", "guests", "socialPreference"] as const;
  const agreements = habits.filter((key) => left[key] === right[key]).length;
  const shared = intersection(leftTags, rightTags);
  const union = new Set([...leftTags, ...rightTags].map(normalize));
  const tags = union.size ? shared.length / union.size : 0;
  const rent = intervalOverlap(left.minAnnualRentKobo, left.maxAnnualRentKobo,
    right.minAnnualRentKobo, right.maxAnnualRentKobo);
  const dates = intervalOverlap(Date.parse(left.moveInFrom), Date.parse(left.moveInTo),
    Date.parse(right.moveInFrom), Date.parse(right.moveInTo));
  const sameState = normalize(left.state) === normalize(right.state);
  const sameArea = sameState && intersection(left.lgas, right.lgas).length > 0;
  const area = sameArea ? 1 : sameState ? 0.5 : 0;
  const reasons = [
    sameArea ? "Compatible area" : sameState ? "Same state" : "Different area",
    rent > 0 ? "Overlapping rent budget" : "Different rent budget",
    dates > 0 ? "Compatible move-in dates" : "Different move-in dates",
  ];
  if (agreements >= 2) reasons.push("Similar living habits");
  if (shared.length) reasons.push("Shared interests and hobbies");
  if (!roommatesCoreCompatible(left, right)) reasons.push("Some roommate preferences differ");
  return { score: Math.round(agreements / 4 * 35 + tags * 25 + area * 10 + rent * 20 + dates * 10), reasons };
};
