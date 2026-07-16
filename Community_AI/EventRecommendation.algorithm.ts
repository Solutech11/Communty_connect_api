import { Types } from "mongoose";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { AppError } from "../utils/AppError";

// Hybrid recommendation model: MongoDB finds viable events, then this module
// ranks them locally. The event feed therefore does not spend Groq tokens.
export const EVENT_RECOMMENDATION_MODEL = "nearby-content-v1";

// GeoJSON always stores coordinates as [longitude, latitude], not [latitude, longitude].
type Coordinates = [number, number];

interface RecommendationEvent {
  _id: unknown;
  title?: string;
  activityType: string;
  targetAudience?: string;
  setting?: string;
  state: string;
  lga: string;
  tags?: string[];
  startsAt: Date | string;
  coordinates?: {
    type?: string;
    coordinates?: number[];
  };
  distanceMeters?: number;
  [key: string]: unknown;
}

interface RecommendationProfile {
  interests: string[];
  state?: string;
  lga?: string;
  learnedActivityWeights: Record<string, number>;
  learnedTagWeights: Record<string, number>;
}

interface RecommendationOptions {
  userId: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  limit?: number;
  extraPreferences?: string[];
}

interface ScoredRecommendation<T extends RecommendationEvent> {
  event: T;
  score: number;
  distanceKm?: number;
  reasons: string[];
}

const normalize = (value: string): string => value.trim().toLowerCase();

const uniqueNormalized = (values: string[]): string[] => {
  return [...new Set(values.map(normalize).filter(Boolean))];
};

const overlapCount = (left: string[], right: string[]): number => {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
};

// MongoDB supplies distanceMeters for geospatial queries. Haversine is the
// deterministic fallback used by unit tests and non-aggregation callers.
const coordinateDistanceKm = (
  from: Coordinates,
  eventCoordinates?: number[],
): number | undefined => {
  if (!eventCoordinates || eventCoordinates.length !== 2) {
    return undefined;
  }

  const [eventLongitude, eventLatitude] = eventCoordinates;
  if (eventLongitude === undefined || eventLatitude === undefined) {
    return undefined;
  }

  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(eventLatitude - from[1]);
  const longitudeDelta = toRadians(eventLongitude - from[0]);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from[1])) *
      Math.cos(toRadians(eventLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const scoreEventRecommendation = <T extends RecommendationEvent>(input: {
  event: T;
  profile: RecommendationProfile;
  userCoordinates?: Coordinates;
  radiusKm: number;
  popularity: number;
  now?: Date;
}): ScoredRecommendation<T> => {
  const { event, profile, userCoordinates, radiusKm, popularity } = input;
  const now = input.now || new Date();
  const eventTokens = uniqueNormalized([
    event.activityType,
    event.targetAudience || "",
    ...(event.tags || []),
  ]);
  const interests = uniqueNormalized(profile.interests);
  const interestMatches = overlapCount(eventTokens, interests);
  const distanceKm = event.distanceMeters !== undefined
    ? event.distanceMeters / 1000
    : userCoordinates
      ? coordinateDistanceKm(userCoordinates, event.coordinates?.coordinates)
      : undefined;

  let score = 0;
  const reasons: string[] = [];

  // Distance is deliberately the strongest signal so nearby events remain first.
  if (distanceKm !== undefined) {
    const distanceScore = Math.max(0, 55 * (1 - distanceKm / Math.max(radiusKm, 1)));
    score += distanceScore;
    reasons.push(distanceKm < 1 ? "Less than 1 km away" : `${distanceKm.toFixed(1)} km away`);
  }

  // Signal caps keep one noisy preference or a long purchase history from
  // overwhelming proximity, which remains the product's primary requirement.
  if (interestMatches > 0) {
    score += Math.min(20, interestMatches * 8);
    reasons.push("Matches your interests");
  }

  const learnedActivity = profile.learnedActivityWeights[normalize(event.activityType)] || 0;
  const learnedTags = eventTokens.reduce(
    (total, token) => total + (profile.learnedTagWeights[token] || 0),
    0,
  );
  const historyScore = Math.min(12, learnedActivity * 3 + learnedTags);
  if (historyScore > 0) {
    score += historyScore;
    reasons.push("Similar to events you joined");
  }

  if (profile.lga && normalize(profile.lga) === normalize(event.lga)) {
    score += 6;
    reasons.push("In your local area");
  } else if (profile.state && normalize(profile.state) === normalize(event.state)) {
    score += 3;
    reasons.push("In your state");
  }

  // Logarithmic popularity rewards well-attended events without allowing a
  // single viral event to permanently dominate every user's recommendations.
  score += Math.min(4, Math.log2(popularity + 1));

  const startsAt = new Date(event.startsAt);
  const daysUntilEvent = Math.max(0, (startsAt.getTime() - now.getTime()) / 86_400_000);
  score += Math.max(0, 3 - daysUntilEvent / 14);

  return {
    event,
    score: Number(score.toFixed(3)),
    distanceKm: distanceKm === undefined ? undefined : Number(distanceKm.toFixed(2)),
    reasons: [...new Set(reasons)].slice(0, 3),
  };
};

export const rankEventRecommendations = <T extends RecommendationEvent>(input: {
  events: T[];
  profile: RecommendationProfile;
  userCoordinates?: Coordinates;
  radiusKm: number;
  popularityByEventId?: Record<string, number>;
  now?: Date;
}): Array<ScoredRecommendation<T>> => {
  return input.events
    .map((event) =>
      scoreEventRecommendation({
        event,
        profile: input.profile,
        userCoordinates: input.userCoordinates,
        radiusKm: input.radiusKm,
        popularity: input.popularityByEventId?.[String(event._id)] || 0,
        now: input.now,
      }),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      // A nearest-first tie-breaker makes equal scores stable and predictable.
      return (left.distanceKm ?? Number.MAX_SAFE_INTEGER) -
        (right.distanceKm ?? Number.MAX_SAFE_INTEGER);
    });
};

const buildRecommendationProfile = (
  interests: string[],
  state: string | undefined,
  lga: string | undefined,
  historyEvents: RecommendationEvent[],
  orderWeights: Record<string, number>,
): RecommendationProfile => {
  const learnedActivityWeights: Record<string, number> = {};
  const learnedTagWeights: Record<string, number> = {};

  // Only paid ticket history reaches this function, so abandoned checkouts
  // cannot teach the recommendation profile a false preference.
  for (const event of historyEvents) {
    const weight = Math.max(1, orderWeights[String(event._id)] || 1);
    const activity = normalize(event.activityType);
    learnedActivityWeights[activity] = (learnedActivityWeights[activity] || 0) + weight;

    for (const tag of uniqueNormalized(event.tags || [])) {
      learnedTagWeights[tag] = (learnedTagWeights[tag] || 0) + weight;
    }
  }

  return {
    interests: uniqueNormalized(interests),
    state,
    lga,
    learnedActivityWeights,
    learnedTagWeights,
  };
};

export const getPersonalizedEventRecommendations = async (
  options: RecommendationOptions,
): Promise<{
  model: string;
  locationUsed: { latitude: number; longitude: number } | null;
  events: Array<RecommendationEvent & {
    recommendationScore: number;
    distanceKm?: number;
    recommendationReasons: string[];
  }>;
}> => {
  const user = await UserModel.findById(options.userId)
    .select("interests state lga location")
    .lean();

  if (!user) {
    throw new AppError(404, "Profile was not found", "PROFILE_NOT_FOUND");
  }

  // Fresh request coordinates override the saved profile location. This lets
  // travelling users discover events around their current position.
  const storedCoordinates = user.location?.coordinates;
  const userCoordinates: Coordinates | undefined =
    options.longitude !== undefined && options.latitude !== undefined
      ? [options.longitude, options.latitude]
      : storedCoordinates?.length === 2
        ? [storedCoordinates[0] as number, storedCoordinates[1] as number]
        : undefined;
  const radiusKm = options.radiusKm || 100;
  // Oversample before scoring so personalization has enough nearby candidates,
  // while the hard ceiling protects MongoDB and response latency.
  const candidateLimit = Math.min(Math.max((options.limit || 20) * 10, 100), 300);
  const baseQuery = { status: "published" as const, startsAt: { $gte: new Date() } };

  let candidates: RecommendationEvent[];

  if (userCoordinates) {
    candidates = await EventModel.aggregate<RecommendationEvent>([
      {
        $geoNear: {
          near: { type: "Point", coordinates: userCoordinates },
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: baseQuery,
        },
      },
      { $limit: candidateLimit },
    ]);
  } else {
    candidates = await EventModel.find(baseQuery)
      .sort({ startsAt: 1, publishedAt: -1 })
      .limit(candidateLimit)
      .lean() as unknown as RecommendationEvent[];
  }

  // Successful attendance intent is the learning signal; pending, cancelled,
  // and refunded orders are deliberately excluded.
  const paidOrders = await TicketOrderModel.find({ buyerId: user._id, status: "paid" })
    .select("eventId quantity")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const orderWeights: Record<string, number> = {};

  for (const order of paidOrders) {
    const eventId = String(order.eventId);
    orderWeights[eventId] = (orderWeights[eventId] || 0) + order.quantity;
  }

  const historyIds = Object.keys(orderWeights).map((id) => new Types.ObjectId(id));
  const historyEvents = historyIds.length > 0
    ? await EventModel.find({ _id: { $in: historyIds } })
        .select("activityType targetAudience tags state lga startsAt coordinates")
        .lean() as unknown as RecommendationEvent[]
    : [];
  const candidateIds = candidates.map((event) => event._id);
  const popularityRows = candidateIds.length > 0
    ? await TicketOrderModel.aggregate<{ _id: Types.ObjectId; attendees: number }>([
        { $match: { eventId: { $in: candidateIds }, status: "paid" } },
        { $group: { _id: "$eventId", attendees: { $sum: "$quantity" } } },
      ])
    : [];
  const popularityByEventId = Object.fromEntries(
    popularityRows.map((row) => [String(row._id), row.attendees]),
  );
  const profile = buildRecommendationProfile(
    [...(user.interests || []), ...(options.extraPreferences || [])],
    user.state,
    user.lga,
    historyEvents,
    orderWeights,
  );
  const ranked = rankEventRecommendations({
    events: candidates,
    profile,
    userCoordinates,
    radiusKm,
    popularityByEventId,
  }).slice(0, options.limit || 20);
  // Populate after ranking so creator joins do not complicate the geospatial
  // pipeline or alter the already-computed recommendation order.
  const populated = await EventModel.populate(
    ranked.map((item) => item.event),
    { path: "creatorId", select: "firstName lastName avatarUrl" },
  ) as unknown as RecommendationEvent[];
  const rankingById = new Map(ranked.map((item) => [String(item.event._id), item]));

  return {
    model: EVENT_RECOMMENDATION_MODEL,
    locationUsed: userCoordinates
      ? { latitude: userCoordinates[1], longitude: userCoordinates[0] }
      : null,
    events: populated.map((event) => {
      const ranking = rankingById.get(String(event._id));
      return {
        ...event,
        recommendationScore: ranking?.score || 0,
        distanceKm: ranking?.distanceKm,
        recommendationReasons: ranking?.reasons || [],
      };
    }),
  };
};

