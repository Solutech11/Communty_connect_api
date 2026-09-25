export type OpenApiSchema = Record<string, unknown>;

import {
  DISPUTE_STATUSES,
  EVENT_STATUSES,
  TRANSACTION_STATUSES,
  USER_PARTICIPATION_ROLES,
  USER_PREFERRED_GROUP_SIZES,
  USER_PREFERRED_SETTINGS,
  USER_ROLES,
} from "../Constant";

export interface RequestBodyContract {
  contentType: "application/json" | "multipart/form-data";
  description: string;
  schema: OpenApiSchema;
  example: unknown;
}

export interface QueryParameterContract {
  name: string;
  description: string;
  required?: boolean;
  schema: OpenApiSchema;
  example?: unknown;
}

export interface SuccessContract {
  status: 200 | 201 | 202;
  description: string;
  example: Record<string, unknown>;
  examples?: Record<string, { summary: string; value: Record<string, unknown> }>;
}

export type OpenApiEnumValue = string | number | boolean;
export type OpenApiEnumValues = readonly OpenApiEnumValue[];

const eventSettings = ["indoor", "outdoor", "online", "hybrid"] as const;
const pointTypes = ["Point"] as const;
const reportRequestReasons = ["spam", "harassment", "hate", "violence", "scam", "unsafe", "misinformation", "other"] as const;
const reportModelReasons = ["spam", "harassment", "hate", "hate_speech", "violence", "scam", "unsafe", "inappropriate", "misinformation", "other"] as const;
const communityMessageReportReasons = ["spam", "harassment", "hate_speech", "unsafe", "inappropriate", "other"] as const;
const ticketOrderStatuses = ["pending", "paid", "cancelled", "refunded"] as const;
const objectIdResponseSchema: OpenApiSchema = { type: "string", pattern: "^[a-fA-F0-9]{24}$" };
const dateTimeResponseSchema: OpenApiSchema = { type: "string", format: "date-time" };
const ticketTypeResponseSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["_id", "eventId", "title", "priceKobo", "sold", "active", "createdAt", "updatedAt"],
  properties: {
    _id: objectIdResponseSchema,
    eventId: objectIdResponseSchema,
    title: { type: "string", minLength: 2, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    priceKobo: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
    capacity: { type: "integer", minimum: 1, maximum: 1_000_000 },
    sold: { type: "integer", minimum: 0 },
    reserved: { type: "integer", minimum: 0, description: "May be included in a newly created ticket type; excluded from ordinary ticket-type reads." },
    active: { type: "boolean" },
    createdAt: dateTimeResponseSchema,
    updatedAt: dateTimeResponseSchema,
  },
};

const ticketEventSummarySchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["_id", "title", "startsAt", "endsAt", "venueName", "address", "state", "lga"],
  properties: {
    _id: objectIdResponseSchema,
    title: { type: "string" },
    coverImageUrl: { type: "string", format: "uri" },
    startsAt: dateTimeResponseSchema,
    endsAt: dateTimeResponseSchema,
    venueName: { type: "string" },
    address: { type: "string" },
    state: { type: "string" },
    lga: { type: "string" },
  },
};

const ticketTypePriceSummarySchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["_id", "title", "priceKobo"],
  properties: {
    _id: objectIdResponseSchema,
    title: { type: "string" },
    priceKobo: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
  },
};

const ticketTypeNameSummarySchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["_id", "title"],
  properties: { _id: objectIdResponseSchema, title: { type: "string" } },
};

const ticketBuyerSummarySchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["_id", "firstName", "lastName", "email"],
  properties: {
    _id: objectIdResponseSchema,
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string", format: "email" },
    avatarUrl: { type: "string", format: "uri" },
  },
};

const ticketOrderBaseProperties: Record<string, OpenApiSchema> = {
  _id: objectIdResponseSchema,
  orderNumber: { type: "string", pattern: "^CC-\\d+-[A-F0-9]{8}$" },
  eventId: objectIdResponseSchema,
  ticketTypeId: objectIdResponseSchema,
  buyerId: objectIdResponseSchema,
  quantity: { type: "integer", minimum: 1, maximum: 20 },
  ticketSubtotalKobo: { type: "integer", minimum: 0 },
  platformFeeKobo: { type: "integer", minimum: 0 },
  totalKobo: { type: "integer", minimum: 0 },
  organizerProceedsKobo: { type: "integer", minimum: 0 },
  status: { type: "string", enum: [...ticketOrderStatuses] },
  paymentReference: { type: "string" },
  idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
  reservationExpiresAt: dateTimeResponseSchema,
  checkedInAt: dateTimeResponseSchema,
  checkedInBy: objectIdResponseSchema,
  createdAt: dateTimeResponseSchema,
  updatedAt: dateTimeResponseSchema,
};
const ticketOrderRequired = [
  "_id", "orderNumber", "eventId", "ticketTypeId", "buyerId", "quantity",
  "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "organizerProceedsKobo",
  "status", "idempotencyKey", "createdAt", "updatedAt",
];
const ticketOrderResponseSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ticketOrderRequired,
  properties: ticketOrderBaseProperties,
};
const myTicketOrderResponseSchema: OpenApiSchema = {
  ...ticketOrderResponseSchema,
  properties: {
    ...ticketOrderBaseProperties,
    eventId: ticketEventSummarySchema,
    ticketTypeId: ticketTypePriceSummarySchema,
  },
};
const attendeeOrderResponseSchema: OpenApiSchema = {
  ...ticketOrderResponseSchema,
  required: [...ticketOrderRequired, "checkedIn", "checkedInAt"],
  properties: {
    ...ticketOrderBaseProperties,
    ticketTypeId: ticketTypeNameSummarySchema,
    buyerId: ticketBuyerSummarySchema,
    checkedIn: { type: "boolean" },
    checkedInAt: { type: ["string", "null"], format: "date-time" },
  },
};

export const ticketResponseSchemaContracts: Record<string, Record<string, OpenApiSchema>> = {
  "GET /events/{id}": { "data.ticketTypes[]": ticketTypeResponseSchema },
  "POST /events/{id}/ticket-types": { "data.ticketType": ticketTypeResponseSchema },
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": { "data.ticketType": ticketTypeResponseSchema },
  "POST /events/{id}/orders": { "data.order": ticketOrderResponseSchema },
  "GET /events/{id}/attendees": { "data.attendees[]": attendeeOrderResponseSchema },
  "POST /events/{id}/check-ins": { "data.order": ticketOrderResponseSchema },
  "GET /tickets": { "data.tickets[]": myTicketOrderResponseSchema },
  "GET /tickets/{orderNumber}": { "data.order": myTicketOrderResponseSchema },
  "GET /tickets/{orderNumber}/verify": { "data.order": myTicketOrderResponseSchema },
};
const userStatuses = ["pending_verification", "active", "suspended", "deleted"] as const;
// Mirrored from models/Community/CommunityMember.model.ts to keep the docs
// generator independent from Mongoose model registration.
const communityMemberRoles = ["owner", "moderator", "member"] as const;
const communityMemberStatuses = ["pending", "active", "rejected", "removed", "banned"] as const;
const communityNotificationLevels = ["all", "announcements", "mentions", "muted"] as const;

/**
 * Enum values are mirrored from the Zod route validators. Keeping these next
 * to the request contracts makes Swagger disclose the same accepted values.
 */
export const requestBodyEnumContracts: Record<string, Record<string, OpenApiEnumValues>> = {
  "POST /auth/register": { "location.type": pointTypes },
  "PATCH /users/me": {
    "location.type": pointTypes,
    preferredSetting: USER_PREFERRED_SETTINGS,
    preferredGroupSize: USER_PREFERRED_GROUP_SIZES,
    participationRole: USER_PARTICIPATION_ROLES,
  },
  "POST /users/{id}/reports": { reason: reportRequestReasons },
  "PATCH /friends/requests/{id}": { action: ["accept", "decline", "reject"] },
  "POST /chat/conversations": { type: ["direct", "group", "support"] },
  "POST /chat/conversations/{id}/messages": { type: ["text", "image"] },
  "PATCH /communities/{id}/settings": {
    joinPolicy: ["open", "approval", "invite_only", "access_code"],
    messagePermission: ["everyone", "moderators"],
  },
  "PATCH /communities/{id}/members/{userId}": {
    role: ["moderator", "member"],
    status: ["active", "removed"],
  },
  "PATCH /communities/{id}/join-requests/{requestId}": { status: ["approved", "rejected"] },
  "POST /communities/{id}/calls": { type: ["voice", "video"] },
  "PATCH /communities/{id}/notification-preferences/me": { level: communityNotificationLevels },
  "POST /communities/{id}/messages/{messageId}/reports": { reason: communityMessageReportReasons },
  "POST /communities/{id}/reports": { reason: reportRequestReasons },
  "POST /events": { setting: eventSettings, "coordinates.type": pointTypes },
  "PATCH /events/{id}": { setting: eventSettings, "coordinates.type": pointTypes },
  "POST /events/{id}/reports": { reason: reportRequestReasons },
  "POST /communities": {
    visibility: ["public", "private"],
    membershipType: ["free", "premium"],
  },
  "PATCH /communities/{id}": {
    visibility: ["public", "private"],
    membershipType: ["free", "premium"],
  },
  "POST /disputes": { category: ["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"] },
  "PATCH /disputes/{id}/status": { status: DISPUTE_STATUSES },
  "POST /uploads/files": { folder: ["community-chat"] },
  "POST /uploads/images": { folder: ["avatars", "events", "communities", "disputes", "chat", "uploads"] },
};

const responseEnumContractsByObject: Record<string, Record<string, OpenApiEnumValues>> = {
  location: { type: pointTypes },
  event: { setting: eventSettings, status: EVENT_STATUSES },
  moderation: { provider: ["groq", "test_override"], verdict: ["approved", "rejected"] },
  user: {
    role: USER_ROLES,
    status: userStatuses,
    preferredSetting: USER_PREFERRED_SETTINGS,
    preferredGroupSize: USER_PREFERRED_GROUP_SIZES,
    participationRole: USER_PARTICIPATION_ROLES,
  },
  community: {
    visibility: ["public", "private"],
    membershipType: ["free", "premium"],
    joinPolicy: ["open", "approval", "invite_only", "access_code"],
    messagePermission: ["everyone", "moderators"],
  },
  settings: {
    joinPolicy: ["open", "approval", "invite_only", "access_code"],
    messagePermission: ["everyone", "moderators"],
  },
  viewerMembership: { role: communityMemberRoles, status: communityMemberStatuses },
  member: {
    communityRole: communityMemberRoles,
    status: communityMemberStatuses,
  },
  joinRequest: { status: ["pending", "approved", "rejected", "cancelled"] },
  friendship: { status: ["pending", "accepted", "declined", "blocked"] },
  request: { status: ["pending", "accepted", "declined", "blocked"] },
  wallet: { status: ["active", "frozen", "closed"] },
  transaction: {
    type: ["topup", "internal_transfer", "withdrawal", "ticket_purchase", "community_purchase", "refund", "adjustment"],
    direction: ["credit", "debit"],
    status: TRANSACTION_STATUSES,
    provider: ["internal", "paystack"],
  },
  order: { status: ticketOrderStatuses },
  conversation: { type: ["direct", "group", "support", "ai"] },
  message: { type: ["text", "image", "system"], kind: ["post", "announcement", "message"] },
  lastMessagePreview: { type: ["text", "image", "system"] },
  post: { kind: ["post", "announcement", "message"] },
  announcement: { kind: ["post", "announcement", "message"] },
  call: { type: ["voice", "video"], status: ["active", "ended"] },
  report: {
    targetType: ["event", "community", "user", "community_message"],
    reason: reportModelReasons,
    status: ["open", "reviewing", "resolved", "dismissed"],
  },
  dispute: {
    category: ["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"],
    status: DISPUTE_STATUSES,
    priority: ["low", "normal", "high", "urgent"],
  },
  attachment: { type: ["image", "pdf", "file"] },
  session: { purpose: ["assistant", "event_copy", "recommendations", "chat_summary", "moderation"] },
};

const pluralObjectNames: Record<string, string> = {
  announcements: "announcement",
  calls: "call",
  communities: "community",
  conversations: "conversation",
  disputes: "dispute",
  events: "event",
  friendships: "friendship",
  requests: "friendship",
  joinRequests: "joinRequest",
  members: "user",
  messages: "message",
  orders: "order",
  posts: "post",
  reports: "report",
  sessions: "session",
  transactions: "transaction",
  tickets: "order",
  users: "user",
  eventId: "event",
  communityId: "community",
  requester: "user",
  requesterId: "user",
  addressee: "user",
  addresseeId: "user",
  sender: "user",
  senderId: "user",
  authorId: "user",
  updatedBy: "user",
  createdBy: "user",
  reviewedBy: "user",
  checkedInBy: "user",
  deletedBy: "user",
  participants: "user",
};

const responseRootEnumContracts: Record<string, Record<string, OpenApiEnumValues>> = {
  "PATCH /communities/{id}/notification-preferences/me": { "data.level": communityNotificationLevels },
  "PUT /communities/{id}/bans/{userId}": { "data.status": ["banned"] },
  "DELETE /communities/{id}/bans/{userId}": { "data.status": ["removed"] },
  "DELETE /communities/{id}/join-requests/me": { "data.status": ["cancelled"] },
};

const responseEnumOverrides = (
  path: string,
  operationKey: string,
): OpenApiEnumValues | undefined => {
  const specific = responseRootEnumContracts[operationKey]?.[path];
  if (specific) return specific;

  const segments = path.split(".");
  const property = segments.at(-1) || "";
  const rawParent = segments.at(-2)?.replace(/\[\]$/, "") || "";
  const parent = pluralObjectNames[rawParent] || rawParent;
  return responseEnumContractsByObject[parent]?.[property];
};

const applyEnumOverrides = (
  schema: OpenApiSchema,
  resolveEnum: (path: string) => OpenApiEnumValues | undefined,
): OpenApiSchema => {
  const visit = (node: OpenApiSchema, path: string): OpenApiSchema => {
    const result: OpenApiSchema = { ...node };
    const enumValues = resolveEnum(path);

    if (enumValues) {
      delete result.const;
      result.enum = [...enumValues];
    }

    if (node.properties && typeof node.properties === "object") {
      result.properties = Object.fromEntries(
        Object.entries(node.properties as Record<string, OpenApiSchema>).map(([name, child]) => [
          name,
          visit(child, path ? path + "." + name : name),
        ]),
      );
    }

    if (node.items && typeof node.items === "object") {
      result.items = visit(node.items as OpenApiSchema, path + "[]");
    }

    return result;
  };

  return visit(schema, "");
};

export const applyRequestBodyEnumContracts = (schema: OpenApiSchema, operationKey: string): OpenApiSchema => {
  const contracts = requestBodyEnumContracts[operationKey] || {};
  return applyEnumOverrides(schema, (path) => contracts[path]);
};

export const applyResponseEnumContracts = (schema: OpenApiSchema, operationKey: string): OpenApiSchema => {
  return applyEnumOverrides(schema, (path) => responseEnumOverrides(path, operationKey));
};

const id = "6650f0c8b9f1c2d3e4a5b6c7";
const secondId = "6650f0c8b9f1c2d3e4a5b6c8";
const createdAt = "2026-07-18T09:30:00.000Z";
const refreshToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example-refresh-token-value-returned-by-the-api.signature";

const user = {
  _id: id,
  firstName: "Ada",
  lastName: "Okafor",
  email: "ada@example.com",
  role: "member",
  status: "active",
  state: "Lagos",
  lga: "Ikeja",
  interests: ["technology", "music"],
  avatarUrl: "https://res.cloudinary.com/example/avatar.webp",
  createdAt,
};

const profileUser = {
  ...user,
  phone: "+2348012345678",
  bio: "Community organizer and product designer.",
  country: "Nigeria",
  location: { type: "Point", coordinates: [3.3792, 6.5244] },
  preferredSetting: "indoor",
  preferredGroupSize: "medium",
  participationRole: "participant",
  hobbies: ["photography", "cooking"],
};

const profileTotals = {
  connections: 42,
  // This count includes all events created by the signed-in user, regardless
  // of whether an event is draft, published, completed, or cancelled.
  events: 6,
};

const secondUser = {
  ...user,
  _id: secondId,
  firstName: "Chidi",
  lastName: "Eze",
  email: "chidi@example.com",
};

const session = {
  accessToken: "eyJhbGciOiJIUzI1NiJ9.example-access-token.signature",
  refreshToken,
  accessTokenExpiresIn: "15m",
};

const event = {
  _id: id,
  creatorId: secondId,
  title: "Lagos Tech Meetup 2026",
  slug: "lagos-tech-meetup-2026-a1b2c3d4",
  description: "An evening of practical talks, networking, and community building.",
  coverImageUrl: "https://res.cloudinary.com/example/event.webp",
  activityType: "Technology",
  setting: "indoor",
  country: "Nigeria",
  state: "Lagos",
  lga: "Ikeja",
  venueName: "Community Hall",
  address: "12 Example Street, Ikeja",
  startsAt: "2026-09-20T16:00:00.000Z",
  endsAt: "2026-09-20T20:00:00.000Z",
  timezone: "Africa/Lagos",
  coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
  maxCapacity: 250,
  contactPhone: "+2348012345678",
  tags: ["technology", "networking"],
  status: "published",
  moderation: {
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    verdict: "approved",
    reviewedAt: createdAt,
    reasons: [],
    checks: {
      content: { acceptable: true, reasons: [] },
      image: { acceptable: true, reasons: [] },
      pricing: { acceptable: true, reasons: [] },
      communityGuidelines: { acceptable: true, reasons: [] },
    },
  },
  approvedAt: createdAt,
  publishedAt: createdAt,
  createdAt,
  updatedAt: createdAt,
};

const ticketType = {
  _id: secondId,
  eventId: id,
  title: "General Admission",
  description: "Standard event access",
  priceKobo: 500000,
  capacity: 200,
  sold: 10,
  active: true,
  createdAt,
  updatedAt: createdAt,
};

const ticketEventSummary = {
  _id: id,
  title: event.title,
  coverImageUrl: event.coverImageUrl,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  venueName: event.venueName,
  address: event.address,
  state: event.state,
  lga: event.lga,
};

const ticketTypePriceSummary = {
  _id: secondId,
  title: ticketType.title,
  priceKobo: ticketType.priceKobo,
};

const orderBase = {
  _id: id,
  orderNumber: "CC-1784370000000-A1B2C3D4",
  eventId: id,
  ticketTypeId: secondId,
  buyerId: user,
  quantity: 1,
  ticketSubtotalKobo: 500000,
  platformFeeKobo: 25000,
  totalKobo: 525000,
  organizerProceedsKobo: 500000,
  status: "paid",
  paymentReference: "ticket_550e8400-e29b-41d4-a716-446655440000",
  idempotencyKey: "ticket-order-550e8400-e29b-41d4",
  reservationExpiresAt: "2026-09-20T16:20:00.000Z",
  createdAt,
  updatedAt: createdAt,
};

const order = {
  ...orderBase,
  eventId: ticketEventSummary,
  ticketTypeId: ticketTypePriceSummary,
};

const attendeeOrder = {
  ...orderBase,
  ticketTypeId: { _id: secondId, title: ticketType.title },
  buyerId: { _id: user, firstName: "Ada", lastName: "Okafor", email: "ada@example.com", avatarUrl: user.avatarUrl },
  checkedIn: true,
  checkedInAt: createdAt,
};

const community = {
  _id: id,
  ownerId: secondId,
  name: "Lagos Product Builders",
  slug: "lagos-product-builders-a1b2c3",
  description: "A community for product designers, engineers, and founders in Lagos.",
  imageUrl: "https://res.cloudinary.com/example/community.webp",
  category: "Technology",
  state: "Lagos",
  lga: "Ikeja",
  visibility: "public",
  membershipType: "premium",
  membershipPriceKobo: 200000,
  joinPolicy: "approval",
  messagePermission: "everyone",
  membersCanCreatePosts: true,
  membersCanInvite: false,
  showMemberList: true,
  members: [secondId],
  moderators: [],
  createdAt,
  updatedAt: createdAt,
};

const transaction = {
  _id: id,
  reference: "topup_550e8400-e29b-41d4-a716-446655440000",
  type: "topup",
  direction: "credit",
  amountKobo: 100000,
  feeKobo: 1000,
  status: "pending",
  provider: "paystack",
  createdAt,
};

const wallet = {
  _id: id,
  walletNumber: "CC1048293012",
  currency: "NGN",
  availableBalanceKobo: 250000,
  pendingBalanceKobo: 0,
  status: "active",
};

const conversation = {
  _id: id,
  type: "direct",
  title: null,
  participantIds: [id, secondId],
  participants: [user, secondUser],
  lastMessageAt: createdAt,
  lastMessagePreview: {
    _id: secondId,
    senderId: secondId,
    type: "text",
    text: "Hello, are you attending the meetup?",
    createdAt,
  },
  unreadCount: 1,
};

const message = {
  _id: id,
  conversationId: secondId,
  senderId: id,
  sender: user,
  clientMessageId: "mobile-1784370000000",
  type: "text",
  text: "Hello, are you attending the meetup?",
  createdAt,
};

const notification = {
  _id: id,
  type: "ticket_confirmed",
  title: "Your ticket is confirmed",
  body: "Your event ticket is ready in My Tickets.",
  data: { orderId: secondId, route: "MyTickets" },
  createdAt,
};

const disputeMessage = {
  _id: secondId,
  authorId: user,
  message: "The ticket is still unavailable in my account.",
  attachments: ["https://res.cloudinary.com/example/receipt.webp"],
  internal: false,
  createdAt,
  updatedAt: createdAt,
};

const dispute = {
  _id: id,
  userId: secondId,
  category: "payment",
  subject: "Ticket payment needs review",
  description: "My payment succeeded but the ticket was not immediately visible.",
  status: "open",
  priority: "normal",
  messages: [disputeMessage],
  createdAt,
  updatedAt: createdAt,
};

const friendship = {
  _id: id,
  requesterId: secondId,
  addresseeId: id,
  requester: secondUser,
  addressee: user,
  status: "pending",
  createdAt,
};

const communityPost = {
  _id: id,
  communityId: secondId,
  authorId: user,
  kind: "post",
  text: "Welcome to our weekly community update.",
  imageUrl: "https://res.cloudinary.com/example/community-post.webp",
  createdAt,
};

const communityAnnouncement = {
  ...communityPost,
  kind: "announcement",
  text: "Saturday's meetup starts at 10:00 AM.",
};

const communityMessage = {
  ...communityPost,
  kind: "message",
  text: "Is anyone attending the meetup?",
  clientMessageId: "community-mobile-1784370000000",
};

const report = {
  _id: id,
  targetType: "event",
  targetId: secondId,
  reason: "unsafe",
  status: "open",
  createdAt,
};

export const inferSchema = (value: unknown, allowAdditionalProperties = false): OpenApiSchema => {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length > 0 ? inferSchema(value[0], allowAdditionalProperties) : {} };
  }

  if (value !== null && typeof value === "object") {
    const properties = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, inferSchema(item, allowAdditionalProperties)]),
    );
    return { type: "object", additionalProperties: allowAdditionalProperties, properties };
  }

  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }

  if (typeof value === "boolean") {
    return { type: "boolean" };
  }

  if (value === null) {
    return { type: ["string", "null"] };
  }

  const stringValue = String(value);
  if (/^[a-f\d]{24}$/i.test(stringValue)) {
    return { type: "string", pattern: "^[a-fA-F0-9]{24}$", example: stringValue };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(stringValue)) {
    return { type: "string", format: "date-time", example: stringValue };
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(stringValue)) {
    return { type: "string", format: "email", example: stringValue };
  }
  if (/^https?:\/\//.test(stringValue)) {
    return { type: "string", format: "uri", example: stringValue };
  }
  return { type: "string", example: stringValue };
};

const jsonBody = (
  example: Record<string, unknown>,
  required: string[],
  description = "Validated JSON request body. Unknown fields are rejected.",
): RequestBodyContract => ({
  contentType: "application/json",
  description,
  example,
  schema: {
    ...inferSchema(example),
    required,
  },
});

const ok = (
  messageText: string,
  data?: unknown,
  status: 200 | 201 | 202 = 200,
): SuccessContract => ({
  status,
  description: messageText,
  example: {
    success: true,
    message: messageText,
    ...(data === undefined ? {} : { data }),
  },
});

const query = (
  name: string,
  description: string,
  schema: OpenApiSchema,
  example?: unknown,
): QueryParameterContract => ({ name, description, schema, example });

const paginationQuery = [
  query("page", "One-based page number.", { type: "integer", minimum: 1, default: 1 }, 1),
  query("limit", "Maximum records returned per page.", { type: "integer", minimum: 1, maximum: 100, default: 20 }, 20),
  query("search", "Optional text search, up to 100 characters.", { type: "string", maxLength: 100 }, "technology"),
];

export const requestBodyContracts: Record<string, RequestBodyContract> = {
  "POST /auth/register": jsonBody({ firstName: "Ada", lastName: "Okafor", email: "ada@example.com", password: "StrongPass1!", phone: "+2348012345678", location: { type: "Point", coordinates: [3.3792, 6.5244] } }, ["firstName", "lastName", "email", "password"], "Location is optional. When supplied, send a complete GeoJSON Point with coordinates in [longitude, latitude] order."),
  "POST /auth/verify-email": jsonBody({ email: "ada@example.com", otp: "123456" }, ["email", "otp"]),
  "POST /auth/resend-verification": jsonBody({ email: "ada@example.com" }, ["email"]),
  "POST /auth/login": jsonBody({ email: "ada@example.com", password: "StrongPass1!" }, ["email", "password"]),
  "POST /auth/refresh": jsonBody({ refreshToken }, ["refreshToken"]),
  "POST /auth/logout": jsonBody({ refreshToken }, ["refreshToken"]),
  "POST /auth/forgot-password": jsonBody({ email: "ada@example.com" }, ["email"]),
  "POST /auth/reset-password": jsonBody({ email: "ada@example.com", otp: "123456", newPassword: "NewStrongPass2!" }, ["email", "otp", "newPassword"]),

  "PATCH /users/me": {
    ...jsonBody({
      firstName: "Ada",
      lastName: "Okafor",
      phone: "+2348012345678",
      bio: "Community organizer and product designer.",
      avatarUrl: "https://res.cloudinary.com/example/avatar.webp",
      country: "Nigeria",
      state: "Lagos",
      lga: "Ikeja",
      location: { type: "Point", coordinates: [3.3792, 6.5244] },
      interests: ["technology", "music"],
      preferredSetting: "indoor",
      preferredGroupSize: "medium",
      participationRole: "participant",
      hobbies: ["photography", "cooking"],
    }, [], "Send at least one profile field. GeoJSON coordinates are [longitude, latitude]. Personalization values are normalized lowercase enums."),
    schema: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        firstName: { type: "string", minLength: 2, maxLength: 60 },
        lastName: { type: "string", minLength: 2, maxLength: 60 },
        phone: { type: "string", minLength: 7, maxLength: 24 },
        bio: { type: "string", maxLength: 500 },
        avatarUrl: { type: "string", format: "uri" },
        country: { type: "string", maxLength: 80 },
        state: { type: "string", maxLength: 80 },
        lga: { type: "string", maxLength: 100 },
        location: {
          type: "object",
          additionalProperties: false,
          required: ["coordinates"],
          properties: {
            type: { type: "string", const: "Point", default: "Point" },
            coordinates: {
              type: "array",
              prefixItems: [
                { type: "number", minimum: -180, maximum: 180 },
                { type: "number", minimum: -90, maximum: 90 },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        interests: {
          type: "array",
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 40 },
        },
        preferredSetting: { type: "string", enum: ["indoor", "outdoor"] },
        preferredGroupSize: { type: "string", enum: ["small", "medium", "large"] },
        participationRole: { type: "string", enum: ["participant", "organizer"] },
        hobbies: {
          type: "array",
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 40 },
        },
      },
    },
  },
  "PATCH /users/me/avatar": {
    contentType: "multipart/form-data",
    description: "One JPEG, PNG, or WebP profile image. The API uploads it to Cloudinary and saves the resulting secure URL to the signed-in user.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["image"],
      properties: {
        image: { type: "string", format: "binary" },
      },
    },
    example: { image: "(binary file)" },
  },
  "PATCH /users/me/password": jsonBody({ currentPassword: "StrongPass1!", newPassword: "NewStrongPass2!" }, ["currentPassword", "newPassword"]),
  "POST /users/me/push-tokens": jsonBody({ token: "ExponentPushToken[example_device_token]" }, ["token"]),
  "DELETE /users/me/push-tokens": jsonBody({ token: "ExponentPushToken[example_device_token]" }, ["token"]),
  "DELETE /users/me": jsonBody({ password: "StrongPass1!" }, ["password"]),

  "PUT /communities/{id}/rules": jsonBody({ introduction: "Keep the community welcoming and useful.", rules: [{ title: "Be respectful", description: "Treat every member with respect.", order: 0 }], consequences: ["Repeated violations may result in removal."] }, ["introduction", "rules", "consequences"]),
  "PATCH /communities/{id}/settings": jsonBody({ joinPolicy: "access_code", accessCode: "COMMUNITY-ACCESS-2026", messagePermission: "moderators", membersCanCreatePosts: true, membersCanInvite: false, showMemberList: true }, [], "Send at least one community setting. Access codes are only written; they are never returned by the API."),
  "PATCH /communities/{id}/members/{userId}": jsonBody({ role: "moderator", status: "active" }, [], "Owners may change roles; owners and moderators may update eligible member status."),
  "PUT /communities/{id}/bans/{userId}": jsonBody({ reason: "Repeated harassment in community messages.", expiresAt: "2026-12-31T23:59:59.000Z" }, ["reason"]),
  "POST /communities/{id}/join-requests": jsonBody({ message: "I would like to join the community." }, [], "For an open free public community this activates membership immediately; otherwise a pending request is created."),
  "PATCH /communities/{id}/join-requests/{requestId}": jsonBody({ status: "approved", note: "Welcome to the community." }, ["status"]),
  "POST /communities/{id}/invites": jsonBody({ expiresAt: "2026-12-31T23:59:59.000Z", maxUses: 10 }, ["expiresAt"]),
  "POST /communities/{id}/calls": jsonBody({ type: "video", title: "Weekly planning" }, ["type"]),
  "PATCH /communities/{id}/announcements/{announcementId}": jsonBody({ text: "Updated schedule", imageUrl: "https://res.cloudinary.com/example/announcement.webp", pinned: true }, [], "Send at least one editable announcement field."),
  "PATCH /communities/{id}/messages/{messageId}": jsonBody({ text: "Updated community message" }, ["text"]),
  "POST /communities/{id}/messages/{messageId}/reports": jsonBody({ reason: "harassment", details: "This message violates the community rules." }, ["reason"]),
  "PUT /communities/{id}/messages/read": jsonBody({ lastReadMessageId: secondId }, ["lastReadMessageId"]),
  "PATCH /communities/{id}/notification-preferences/me": jsonBody({ level: "mentions" }, ["level"]),
  "PATCH /communities/{id}/posts/{postId}": jsonBody({ text: "Updated weekly community update.", imageUrl: "https://res.cloudinary.com/example/community-post.webp" }, [], "Send at least one editable post field."),  "POST /communities/{id}/ownership-transfer": jsonBody({ newOwnerId: secondId, currentPassword: "StrongPass1!" }, ["newOwnerId"]),
  "POST /events": jsonBody({ title: "Lagos Tech Meetup 2026", description: "An evening of practical talks, networking, and community building.", coverImageUrl: "https://res.cloudinary.com/example/event.webp", activityType: "Technology", targetAudience: "Developers and founders", setting: "indoor", country: "Nigeria", state: "Lagos", lga: "Ikeja", venueName: "Community Hall", address: "12 Example Street, Ikeja", coordinates: { type: "Point", coordinates: [3.3792, 6.5244] }, startsAt: "2026-09-20T16:00:00.000Z", endsAt: "2026-09-20T20:00:00.000Z", timezone: "Africa/Lagos", contactPhone: "+2348012345678", maxCapacity: 250, tags: ["technology", "networking"] }, ["title", "description", "activityType", "setting", "state", "lga", "venueName", "address", "startsAt", "endsAt", "maxCapacity"]),
  "PATCH /events/{id}": jsonBody({ title: "Updated Lagos Tech Meetup 2026", description: "Updated event description with enough information for attendees.", startsAt: "2026-09-20T17:00:00.000Z", endsAt: "2026-09-20T21:00:00.000Z", maxCapacity: 300 }, [], "Send at least one event field. Drafts and declined events are editable; editing a declined event resets it to draft. If both dates are sent, endsAt must be later than startsAt."),
  "POST /events/{id}/orders": jsonBody({ ticketTypeId: secondId, quantity: 1 }, ["ticketTypeId", "quantity"]),
  "POST /events/{id}/ticket-types": jsonBody({ title: "General Admission", description: "Standard event access", priceKobo: 500000, capacity: 200 }, ["title", "priceKobo"]),
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": jsonBody({ title: "Early Bird", description: "Discounted early access", priceKobo: 400000, capacity: 100 }, [], "Send at least one ticket-type field."),
  "POST /events/{id}/check-ins": jsonBody({ qrToken: "opaque-ticket-token-at-least-thirty-two-characters" }, ["qrToken"]),

  "POST /communities": jsonBody({ name: "Lagos Product Builders", description: "A community for product designers, engineers, and founders in Lagos.", imageUrl: "https://res.cloudinary.com/example/community.webp", category: "Technology", state: "Lagos", lga: "Ikeja", visibility: "public", membershipType: "premium", membershipPriceKobo: 200000 }, ["name", "description", "category"]),
  "PATCH /communities/{id}": jsonBody({ description: "Updated community description for product builders across Lagos.", membershipType: "premium", membershipPriceKobo: 250000 }, [], "Send at least one community field. Premium communities require a positive membershipPriceKobo."),
  "POST /communities/{id}/posts": jsonBody({ text: "Welcome to our weekly community update.", imageUrl: "https://res.cloudinary.com/example/community-post.webp" }, ["text"]),
  "POST /communities/{id}/announcements": jsonBody({ text: "Saturday's meetup starts at 10:00 AM.", imageUrl: "https://res.cloudinary.com/example/announcement.webp" }, ["text"]),
  "POST /communities/{id}/messages": jsonBody({ clientMessageId: "550e8400-e29b-41d4-a716-446655440000", text: "Is anyone attending the meetup?", attachmentIds: [secondId], replyToMessageId: id }, ["clientMessageId"], "Supply text or 1-5 owned attachment IDs; replyToMessageId must be a message in the same community."),
  "POST /communities/{id}/reports": jsonBody({ reason: "unsafe", details: "This community is promoting an unsafe gathering location." }, ["reason"]),

  "POST /events/{id}/reports": jsonBody({ reason: "unsafe", details: "The event venue details appear unsafe and misleading." }, ["reason"]),
  "POST /users/{id}/reports": jsonBody({ reason: "harassment", details: "This account repeatedly sent threatening messages." }, ["reason"]),

  "PATCH /friends/requests/{id}": jsonBody({ action: "accept" }, ["action"]),
  "POST /chat/conversations": jsonBody({ type: "direct", title: "Event planning", participantIds: [secondId] }, ["type", "participantIds"]),
  "POST /chat/conversations/{id}/messages": jsonBody({ clientMessageId: "mobile-1784370000000", type: "text", text: "Hello, are you attending the meetup?", mediaUrl: "https://res.cloudinary.com/example/chat-image.webp" }, ["clientMessageId"], "clientMessageId and either text or mediaUrl are required."),

  "POST /ai/chat": jsonBody({ message: "Recommend technology events near Ikeja.", sessionId: id }, ["message"]),
  "POST /ai/event-copy": jsonBody({ title: "Lagos Tech Meetup", activityType: "Technology", targetAudience: "Developers and founders", setting: "indoor", details: "Practical talks and networking in Ikeja." }, ["title", "activityType"]),
  "POST /ai/event-recommendations": jsonBody({ preferences: { categories: ["technology", "networking"] }, latitude: 6.5244, longitude: 3.3792, radiusKm: 50, limit: 20 }, [], "latitude and longitude must be supplied together when either is present."),

  "POST /disputes": jsonBody({ transactionId: id, category: "payment", subject: "Ticket payment needs review", description: "My payment succeeded but the ticket was not immediately visible." }, ["category", "subject", "description"]),
  "POST /disputes/{id}/messages": jsonBody({ message: "The ticket is still unavailable in my account.", attachments: ["https://res.cloudinary.com/example/receipt.webp"], internal: false }, ["message"]),
  "PATCH /disputes/{id}/status": jsonBody({ status: "resolved", resolution: "Payment reconciled and the ticket was issued." }, ["status"]),

  "POST /wallet/topups": jsonBody({ amountKobo: 100000 }, ["amountKobo"], "Requested wallet credit in integer kobo; the configured deposit fee is added to the Paystack amount."),
  "POST /wallet/bank-accounts": jsonBody({ accountNumber: "0123456789", bankCode: "058" }, ["accountNumber", "bankCode"]),
  "POST /wallet/transfers": jsonBody({ recipient: "recipient@example.com", amountKobo: 50000, note: "Shared event costs" }, ["recipient", "amountKobo"]),
  "POST /wallet/withdrawals": jsonBody({ bankAccountId: id, amountKobo: 100000 }, ["bankAccountId", "amountKobo"], "The configured withdrawal fee is deducted from amountKobo before Paystack payout."),
  "POST /wallet/withdrawals/{reference}/finalize": jsonBody({ otp: "123456" }, ["otp"]),

  "POST /uploads/files": {
    contentType: "multipart/form-data",
    description: "One MIME-checked community image, PDF, or document file.",
    schema: { type: "object", required: ["file", "folder"], properties: { file: { type: "string", format: "binary" }, folder: { type: "string", const: "community-chat" } } },
    example: { folder: "community-chat", file: "(binary file)" },
  },  "POST /uploads/images": {
    contentType: "multipart/form-data",
    description: "One JPEG, PNG, or WebP image plus an optional destination folder.",
    schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" }, folder: { type: "string", enum: ["avatars", "events", "communities", "disputes", "chat", "uploads"], default: "uploads" } } },
    example: { folder: "events", image: "(binary file)" },
  },
  "POST /webhooks/paystack": jsonBody({ event: "charge.success", data: { id: 123456789, reference: "topup_550e8400-e29b-41d4-a716-446655440000", amount: 101000, status: "success" } }, ["event", "data"], "Signed Paystack payload. Paystack must supply x-paystack-signature; clients must not call this endpoint."),
};

const communityUpdateContract = requestBodyContracts["PATCH /communities/{id}"];
if (communityUpdateContract) {
  communityUpdateContract.schema = {
    ...communityUpdateContract.schema,
    properties: {
      ...(communityUpdateContract.schema.properties as Record<string, OpenApiSchema>),
      visibility: { type: "string" },
    },
  };
}

const eventUpdateContract = requestBodyContracts["PATCH /events/{id}"];
if (eventUpdateContract) {
  eventUpdateContract.schema = {
    ...eventUpdateContract.schema,
    properties: {
      ...(eventUpdateContract.schema.properties as Record<string, OpenApiSchema>),
      setting: { type: "string" },
      coordinates: {
        type: "object",
        additionalProperties: false,
        required: ["type", "coordinates"],
        properties: {
          type: { type: "string" },
          coordinates: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            prefixItems: [
              { type: "number", minimum: -180, maximum: 180 },
              { type: "number", minimum: -90, maximum: 90 },
            ],
          },
        },
      },
    },
  };
}

const ticketOrderContract = requestBodyContracts["POST /events/{id}/orders"];
if (ticketOrderContract) {
  ticketOrderContract.description = "Select an active ticket type for the event and order 1-20 tickets. Prices are server-owned; totals and platform fees are calculated from the stored price in integer kobo.";
  ticketOrderContract.schema = {
    type: "object",
    additionalProperties: false,
    required: ["ticketTypeId", "quantity"],
    properties: {
      ticketTypeId: objectIdResponseSchema,
      quantity: { type: "integer", minimum: 1, maximum: 20 },
    },
  };
}

const ticketTypeRequestSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 2, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    priceKobo: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
    capacity: { type: "integer", minimum: 1, maximum: 1_000_000 },
  },
};
const addTicketTypeContract = requestBodyContracts["POST /events/{id}/ticket-types"];
if (addTicketTypeContract) {
  addTicketTypeContract.description = "Creates a ticket tier. priceKobo is a non-negative integer in kobo; title and priceKobo are required.";
  addTicketTypeContract.schema = {
    ...ticketTypeRequestSchema,
    required: ["title", "priceKobo"],
  };
}
const updateTicketTypeContract = requestBodyContracts["PATCH /events/{id}/ticket-types/{ticketTypeId}"];
if (updateTicketTypeContract) {
  updateTicketTypeContract.description = "Updates at least one ticket tier field. priceKobo is a non-negative integer in kobo.";
  updateTicketTypeContract.schema = { ...ticketTypeRequestSchema, minProperties: 1 };
}
const checkInContract = requestBodyContracts["POST /events/{id}/check-ins"];
if (checkInContract) {
  checkInContract.schema = {
    type: "object",
    additionalProperties: false,
    required: ["qrToken"],
    properties: { qrToken: { type: "string", minLength: 32, maxLength: 4096 } },
  };
}

const strictObject = (
  properties: Record<string, OpenApiSchema>,
  required: string[] = [],
  additionalPropertiesOrDescription: boolean | string = false,
  allowAdditionalProperties = false,
): OpenApiSchema => ({
  type: "object",
  additionalProperties: typeof additionalPropertiesOrDescription === "boolean"
    ? additionalPropertiesOrDescription
    : allowAdditionalProperties,
  ...(typeof additionalPropertiesOrDescription === "string"
    ? { description: additionalPropertiesOrDescription }
    : {}),
  required,
  properties,
});

const geoPointRequestSchema: OpenApiSchema = {
  ...strictObject({
    type: { type: "string", const: "Point", default: "Point" },
    coordinates: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      prefixItems: [
        { type: "number", minimum: -180, maximum: 180 },
        { type: "number", minimum: -90, maximum: 90 },
      ],
    },
  }, ["coordinates"]),
};

const reportRequestSchema: OpenApiSchema = strictObject({
  reason: { type: "string", enum: [...reportRequestReasons] },
  details: { type: "string", minLength: 10, maxLength: 2000 },
}, ["reason"]);

const communityRequestSchema: OpenApiSchema = strictObject({
  name: { type: "string", minLength: 3, maxLength: 100 },
  description: { type: "string", minLength: 20, maxLength: 2000 },
  imageUrl: { type: "string", format: "uri" },
  coverImageUrl: { type: "string", format: "uri" },
  avatarImageUrl: { type: "string", format: "uri" },
  accessCode: { type: "string", minLength: 4, maxLength: 128 },
  category: { type: "string", minLength: 2, maxLength: 60 },
  state: { type: "string", maxLength: 80 },
  lga: { type: "string", maxLength: 100 },
  visibility: { type: "string", enum: ["public", "private"], default: "public" },
  membershipType: { type: "string", enum: ["free", "premium"], default: "free" },
  membershipPriceKobo: { type: "integer", minimum: 0, maximum: 10_000_000_000, default: 0 },
});

const eventRequestSchema: OpenApiSchema = strictObject({
  title: { type: "string", minLength: 4, maxLength: 140 },
  description: { type: "string", minLength: 20, maxLength: 5000 },
  coverImageUrl: { type: "string", format: "uri" },
  activityType: { type: "string", minLength: 2, maxLength: 60 },
  targetAudience: { type: "string", maxLength: 60 },
  setting: { type: "string", enum: [...eventSettings] },
  country: { type: "string", minLength: 2, maxLength: 80, default: "Nigeria" },
  state: { type: "string", minLength: 2, maxLength: 80 },
  lga: { type: "string", minLength: 2, maxLength: 100 },
  venueName: { type: "string", minLength: 2, maxLength: 180 },
  address: { type: "string", minLength: 5, maxLength: 300 },
  coordinates: geoPointRequestSchema,
  startsAt: { type: "string", format: "date-time" },
  endsAt: { type: "string", format: "date-time" },
  timezone: { type: "string", minLength: 1, maxLength: 100, default: "Africa/Lagos" },
  contactPhone: { type: "string", minLength: 7, maxLength: 24 },
  maxCapacity: { type: "integer", minimum: 1, maximum: 1_000_000 },
  tags: {
    type: "array",
    maxItems: 10,
    default: [],
    items: { type: "string", minLength: 1, maxLength: 40 },
  },
}, [
  "title", "description", "activityType", "setting", "state", "lga", "venueName",
  "address", "startsAt", "endsAt", "maxCapacity",
]);

const ticketTypeRequestProperties: Record<string, OpenApiSchema> = {
  title: { type: "string", minLength: 2, maxLength: 80 },
  description: { type: "string", maxLength: 300 },
  priceKobo: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
  capacity: { type: "integer", minimum: 1, maximum: 1_000_000 },
};

/**
 * Full request schemas mirrored from the route Zod validators. Keeping these
 * keyed to every documented body makes the examples useful without changing
 * runtime validation or API behavior.
 */
export const requestBodySchemaContracts: Record<string, OpenApiSchema> = {
  "POST /auth/register": strictObject({
    firstName: { type: "string", minLength: 2, maxLength: 60 },
    lastName: { type: "string", minLength: 2, maxLength: 60 },
    email: { type: "string", format: "email", maxLength: 254 },
    password: {
      type: "string", minLength: 6, maxLength: 128,
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).+$",
    },
    phone: { type: "string", minLength: 7, maxLength: 24 },
    location: geoPointRequestSchema,
  }, ["firstName", "lastName", "email", "password"]),
  "POST /auth/verify-email": strictObject({
    email: { type: "string", format: "email", maxLength: 254 },
    otp: { type: "string", pattern: "^\\d{6}$", minLength: 6, maxLength: 6 },
  }, ["email", "otp"]),
  "POST /auth/resend-verification": strictObject({
    email: { type: "string", format: "email", maxLength: 254 },
  }, ["email"]),
  "POST /auth/login": strictObject({
    email: { type: "string", format: "email", maxLength: 254 },
    password: { type: "string", minLength: 1, maxLength: 128 },
  }, ["email", "password"]),
  "POST /auth/refresh": strictObject({
    refreshToken: { type: "string", minLength: 100, maxLength: 4096 },
  }, ["refreshToken"]),
  "POST /auth/logout": strictObject({
    refreshToken: { type: "string", minLength: 100, maxLength: 4096 },
  }, ["refreshToken"]),
  "POST /auth/forgot-password": strictObject({
    email: { type: "string", format: "email", maxLength: 254 },
  }, ["email"]),
  "POST /auth/reset-password": strictObject({
    email: { type: "string", format: "email", maxLength: 254 },
    otp: { type: "string", pattern: "^\\d{6}$", minLength: 6, maxLength: 6 },
    newPassword: {
      type: "string", minLength: 6, maxLength: 128,
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).+$",
    },
  }, ["email", "otp", "newPassword"]),
  "PATCH /users/me": {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: {
      firstName: { type: "string", minLength: 2, maxLength: 60 },
      lastName: { type: "string", minLength: 2, maxLength: 60 },
      phone: { type: "string", minLength: 7, maxLength: 24 },
      bio: { type: "string", maxLength: 500 },
      avatarUrl: { type: "string", format: "uri" },
      country: { type: "string", maxLength: 80 },
      state: { type: "string", maxLength: 80 },
      lga: { type: "string", maxLength: 100 },
      location: geoPointRequestSchema,
      interests: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
      preferredSetting: { type: "string", enum: [...USER_PREFERRED_SETTINGS] },
      preferredGroupSize: { type: "string", enum: [...USER_PREFERRED_GROUP_SIZES] },
      participationRole: { type: "string", enum: [...USER_PARTICIPATION_ROLES] },
      hobbies: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
    },
  },
  "PATCH /users/me/avatar": strictObject({ image: { type: "string", format: "binary" } }, ["image"]),
  "PATCH /users/me/password": strictObject({
    currentPassword: { type: "string", minLength: 1, maxLength: 128 },
    newPassword: {
      type: "string", minLength: 6, maxLength: 128,
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).+$",
    },
  }, ["currentPassword", "newPassword"]),
  "POST /users/me/push-tokens": strictObject({
    token: { type: "string", pattern: "^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$" },
  }, ["token"]),
  "DELETE /users/me/push-tokens": strictObject({
    token: { type: "string", pattern: "^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$" },
  }, ["token"]),
  "DELETE /users/me": strictObject({ password: { type: "string", minLength: 1, maxLength: 128 } }, ["password"]),
  "POST /users/{id}/reports": reportRequestSchema,

  "PUT /communities/{id}/rules": strictObject({
    introduction: { type: "string", minLength: 1, maxLength: 500 },
    rules: {
      type: "array", maxItems: 50,
      items: strictObject({
        _id: objectIdResponseSchema,
        title: { type: "string", minLength: 2, maxLength: 100 },
        description: { type: "string", minLength: 2, maxLength: 1000 },
        order: { type: "integer", minimum: 0, maximum: 1000 },
      }, ["title", "description", "order"]),
    },
    consequences: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 300 } },
  }, ["introduction", "rules", "consequences"]),
  "PATCH /communities/{id}/settings": {
    ...strictObject({
      joinPolicy: { type: "string", enum: ["open", "approval", "invite_only", "access_code"] },
      accessCode: { type: "string", minLength: 4, maxLength: 128, description: "Write-only access code; it is never returned by the API." },
      messagePermission: { type: "string", enum: ["everyone", "moderators"] },
      membersCanCreatePosts: { type: "boolean" },
      membersCanInvite: { type: "boolean" },
      showMemberList: { type: "boolean" },
    }),
    minProperties: 1,
  },
  "PATCH /communities/{id}/members/{userId}": {
    ...strictObject({
      role: { type: "string", enum: ["moderator", "member"] },
      status: { type: "string", enum: ["active", "removed"] },
    }),
    minProperties: 1,
  },
  "PUT /communities/{id}/bans/{userId}": strictObject({
    reason: { type: "string", minLength: 2, maxLength: 500 },
    expiresAt: { type: "string", format: "date-time" },
  }, ["reason"]),
  "POST /communities/{id}/join-requests": strictObject({
    message: { type: "string", maxLength: 500 },
    accessCode: { type: "string", minLength: 4, maxLength: 128 },
    inviteToken: { type: "string", minLength: 8, maxLength: 256 },
  }),
  "POST /communities/{id}/invites": strictObject({
    expiresAt: { type: "string", format: "date-time", description: "Must be a future date and time." },
    maxUses: { type: "integer", minimum: 1, maximum: 10_000 },
  }, ["expiresAt"]),
  "PATCH /communities/{id}/join-requests/{requestId}": strictObject({
    status: { type: "string", enum: ["approved", "rejected"] },
    note: { type: "string", maxLength: 500 },
  }, ["status"]),
  "POST /communities/{id}/calls": strictObject({
    type: { type: "string", enum: ["voice", "video"] },
    title: { type: "string", minLength: 1, maxLength: 120 },
  }, ["type"]),
  "POST /communities/{id}/ownership-transfer": strictObject({
    newOwnerId: objectIdResponseSchema,
    currentPassword: { type: "string", minLength: 1, maxLength: 128 },
  }, ["newOwnerId"]),
  "PUT /communities/{id}/messages/read": strictObject({ lastReadMessageId: objectIdResponseSchema }, ["lastReadMessageId"]),
  "PATCH /communities/{id}/notification-preferences/me": strictObject({
    level: { type: "string", enum: [...communityNotificationLevels] },
  }, ["level"]),
  "PATCH /communities/{id}/announcements/{announcementId}": {
    ...strictObject({
      text: { type: "string", minLength: 1, maxLength: 4000 },
      imageUrl: { type: ["string", "null"], format: "uri" },
      pinned: { type: "boolean" },
    }),
    minProperties: 1,
  },
  "PATCH /communities/{id}/messages/{messageId}": strictObject({
    text: { type: "string", minLength: 1, maxLength: 4000 },
  }, ["text"]),
  "PATCH /communities/{id}/posts/{postId}": {
    ...strictObject({
      text: { type: "string", minLength: 1, maxLength: 4000 },
      imageUrl: { type: ["string", "null"], format: "uri" },
    }),
    minProperties: 1,
  },
  "POST /events": eventRequestSchema,
  "PATCH /events/{id}": {
    ...eventRequestSchema,
    required: [],
    minProperties: 1,
    properties: {
      ...(eventRequestSchema.properties as Record<string, OpenApiSchema>),
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
    },
  },
  "POST /events/{id}/orders": strictObject({
    ticketTypeId: objectIdResponseSchema,
    quantity: { type: "integer", minimum: 1, maximum: 20 },
  }, ["ticketTypeId", "quantity"]),
  "POST /events/{id}/ticket-types": strictObject(ticketTypeRequestProperties, ["title", "priceKobo"]),
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": {
    ...strictObject(ticketTypeRequestProperties),
    minProperties: 1,
  },
  "POST /events/{id}/check-ins": strictObject({
    qrToken: { type: "string", minLength: 32, maxLength: 4096 },
  }, ["qrToken"]),
  "POST /events/{id}/reports": reportRequestSchema,

  "POST /communities": communityRequestSchema,
  "PATCH /communities/{id}": {
    ...communityRequestSchema,
    required: [],
    minProperties: 1,
  },
  "POST /communities/{id}/posts": strictObject({
    text: { type: "string", minLength: 1, maxLength: 4000 },
    imageUrl: { type: "string", format: "uri" },
  }, ["text"]),
  "POST /communities/{id}/announcements": strictObject({
    text: { type: "string", minLength: 1, maxLength: 4000 },
    imageUrl: { type: "string", format: "uri" },
  }, ["text"]),
  "POST /communities/{id}/messages": strictObject({
    clientMessageId: { type: "string", format: "uuid" },
    text: { type: "string", minLength: 1, maxLength: 4000 },
    attachmentIds: { type: "array", maxItems: 5, items: objectIdResponseSchema },
    replyToMessageId: objectIdResponseSchema,
  }, ["clientMessageId"], "A message requires text or at least one attachment."),
  "POST /communities/{id}/messages/{messageId}/reports": strictObject({
    reason: { type: "string", enum: [...communityMessageReportReasons] },
    details: { type: "string", minLength: 1, maxLength: 2000 },
  }, ["reason"]),
  "POST /communities/{id}/reports": reportRequestSchema,

  "PATCH /friends/requests/{id}": strictObject({
    action: { type: "string", enum: ["accept", "decline", "reject"] },
  }, ["action"]),
  "POST /chat/conversations": strictObject({
    type: { type: "string", enum: ["direct", "group", "support"] },
    title: { type: "string", minLength: 2, maxLength: 120 },
    participantIds: { type: "array", minItems: 1, maxItems: 99, items: objectIdResponseSchema },
  }, ["type", "participantIds"]),
  "POST /chat/conversations/{id}/messages": strictObject({
    clientMessageId: { type: "string", minLength: 8, maxLength: 128 },
    type: { type: "string", enum: ["text", "image"], default: "text" },
    text: { type: "string", minLength: 1, maxLength: 4000 },
    mediaUrl: { type: "string", format: "uri" },
  }, ["clientMessageId"], "A text or mediaUrl value must be supplied."),

  "POST /ai/chat": strictObject({
    message: { type: "string", minLength: 1, maxLength: 4000 },
    sessionId: objectIdResponseSchema,
  }, ["message"]),
  "POST /ai/event-copy": strictObject({
    title: { type: "string", minLength: 2, maxLength: 140 },
    activityType: { type: "string", minLength: 2, maxLength: 60 },
    targetAudience: { type: "string", maxLength: 80 },
    setting: { type: "string", maxLength: 40 },
    details: { type: "string", maxLength: 3000 },
  }, ["title", "activityType"]),
  "POST /ai/event-recommendations": strictObject({
    preferences: { type: "object", additionalProperties: true, default: {} },
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
    radiusKm: { type: "number", exclusiveMinimum: 0, maximum: 500, default: 100 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  }, [], "latitude and longitude must be supplied together when either is present."),

  "POST /disputes": strictObject({
    transactionId: objectIdResponseSchema,
    category: { type: "string", enum: ["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"] },
    subject: { type: "string", minLength: 5, maxLength: 160 },
    description: { type: "string", minLength: 20, maxLength: 5000 },
  }, ["category", "subject", "description"]),
  "POST /disputes/{id}/messages": strictObject({
    message: { type: "string", minLength: 1, maxLength: 3000 },
    attachments: { type: "array", maxItems: 5, items: { type: "string", format: "uri" } },
    internal: { type: "boolean" },
  }, ["message"]),
  "PATCH /disputes/{id}/status": strictObject({
    status: { type: "string", enum: [...DISPUTE_STATUSES] },
    resolution: { type: "string", maxLength: 3000 },
  }, ["status"]),

  "POST /wallet/topups": strictObject({
    amountKobo: { type: "integer", exclusiveMinimum: 0, maximum: 10_000_000_000 },
  }, ["amountKobo"]),
  "POST /wallet/bank-accounts": strictObject({
    accountNumber: { type: "string", pattern: "^\\d{10}$", minLength: 10, maxLength: 10 },
    bankCode: { type: "string", pattern: "^\\d{3,6}$", minLength: 3, maxLength: 6 },
  }, ["accountNumber", "bankCode"]),
  "POST /wallet/transfers": strictObject({
    recipient: { type: "string", minLength: 3, maxLength: 254 },
    amountKobo: { type: "integer", exclusiveMinimum: 0, maximum: 10_000_000_000 },
    note: { type: "string", maxLength: 200 },
  }, ["recipient", "amountKobo"]),
  "POST /wallet/withdrawals": strictObject({
    bankAccountId: objectIdResponseSchema,
    amountKobo: { type: "integer", exclusiveMinimum: 0, maximum: 10_000_000_000 },
  }, ["bankAccountId", "amountKobo"]),
  "POST /wallet/withdrawals/{reference}/finalize": strictObject({
    otp: { type: "string", pattern: "^\\d{6}$", minLength: 6, maxLength: 6 },
  }, ["otp"]),
  "POST /uploads/files": strictObject({
    file: { type: "string", format: "binary" },
    folder: { type: "string", const: "community-chat" },
  }, ["file", "folder"]),
  "POST /uploads/images": strictObject({
    image: { type: "string", format: "binary" },
    folder: { type: "string", enum: ["avatars", "events", "communities", "disputes", "chat", "uploads"], default: "uploads" },
  }, ["image"], "One JPEG, PNG, or WebP image. Other multipart fields are accepted by the passthrough request validator.", true),
  "POST /webhooks/paystack": {
    type: "object",
    additionalProperties: true,
    required: ["event", "data"],
    properties: {
      event: { type: "string", description: "Paystack event name, for example charge.success." },
      data: { type: "object", additionalProperties: true, description: "Provider event payload; fields vary by event type." },
    },
  },
};

export const applyRequestBodySchemaContracts = (schema: OpenApiSchema, operationKey: string): OpenApiSchema => {
  return requestBodySchemaContracts[operationKey] || schema;
};

export const queryParameterContracts: Record<string, QueryParameterContract[]> = {
  "GET /locations/search": [
    { ...query("q", "Location search text.", { type: "string", minLength: 1, maxLength: 200 }, "Eko Hotel"), required: true },
    query("countryCode", "Optional ISO 3166-1 alpha-2 country code.", { type: "string", pattern: "^[A-Za-z]{2}$" }, "NG"),
    query("latitude", "Latitude; must be supplied with longitude.", { type: "number", minimum: -90, maximum: 90 }, 6.5244),
    query("longitude", "Longitude; must be supplied with latitude.", { type: "number", minimum: -180, maximum: 180 }, 3.3792),
    query("limit", "Maximum suggestions; larger positive values are capped at 8.", { type: "integer", minimum: 1, default: 8 }, 8),
  ],
  "GET /users/me/communities": [
    query("page", "One-based page number (maximum 10,000).", { type: "integer", minimum: 1, maximum: 10_000, default: 1 }, 1),
    query("limit", "Maximum communities returned per page.", { type: "integer", minimum: 1, maximum: 100, default: 20 }, 20),
    query("search", "Search community name and description.", { type: "string", maxLength: 100 }, "Lagos"),
    query("role", "Filter by viewer role.", { type: "string", enum: ["owner", "moderator", "member"] }, "member"),
    query("status", "Filter active or pending membership.", { type: "string", enum: ["pending", "active"] }, "active"),
    query("unreadOnly", "Only include communities with unread messages.", { type: "string", enum: ["true", "false"] }, "true"),
  ],
  "GET /communities/{id}/members": [
    ...paginationQuery,
    query("search", "Search member name.", { type: "string", maxLength: 100 }, "Ada"),
    query("role", "Filter community role.", { type: "string", enum: ["owner", "moderator", "member"] }, "member"),
    query("status", "Filter active or banned members.", { type: "string", enum: ["active", "banned"] }, "active"),
  ],
  "GET /communities/{id}/join-requests": [
    ...paginationQuery.slice(0, 2),
    query("status", "Filter request review state.", { type: "string", enum: ["pending", "approved", "rejected"] }, "pending"),
  ],  "GET /events": [
    ...paginationQuery,
    query("state", "Filter by state.", { type: "string", maxLength: 80 }, "Lagos"),
    query("lga", "Filter by local government area.", { type: "string", maxLength: 100 }, "Ikeja"),
    query("activityType", "Filter by activity category.", { type: "string", maxLength: 60 }, "Technology"),
    query("latitude", "Latitude; must be supplied with longitude.", { type: "number", minimum: -90, maximum: 90 }, 6.5244),
    query("longitude", "Longitude; must be supplied with latitude.", { type: "number", minimum: -180, maximum: 180 }, 3.3792),
    query("radiusKm", "Maximum geospatial radius in kilometres.", { type: "number", exclusiveMinimum: 0, maximum: 500, default: 100 }, 50),
  ],
  "GET /events/recommended": [
    query("latitude", "Latitude; must be supplied with longitude.", { type: "number", minimum: -90, maximum: 90 }, 6.5244),
    query("longitude", "Longitude; must be supplied with latitude.", { type: "number", minimum: -180, maximum: 180 }, 3.3792),
    query("radiusKm", "Maximum radius in kilometres.", { type: "number", exclusiveMinimum: 0, maximum: 500, default: 100 }, 50),
    query("limit", "Maximum recommendations.", { type: "integer", minimum: 1, maximum: 50, default: 20 }, 20),
  ],
  "GET /communities/{id}/posts": paginationQuery.slice(0, 2),
  "GET /communities/{id}/announcements": paginationQuery.slice(0, 2),
  "GET /communities/{id}/messages": [
    query("limit", "Maximum messages returned before the cursor.", { type: "integer", minimum: 1, maximum: 100, default: 30 }, 30),
    query("before", "Opaque cursor from pageInfo.nextCursor for older messages.", { type: "string" }, "MjAyNi0wNy0xOFQwOTozMDowMC4wMDBaOjY2NTBmMGM4YjlmMWMyZDNlNGE1YjZjNw"),
  ],
  "GET /communities": [
    ...paginationQuery,
    query("category", "Filter by category.", { type: "string", maxLength: 60 }, "Technology"),
    query("state", "Filter by state.", { type: "string", maxLength: 80 }, "Lagos"),
    query("lga", "Filter by local government area.", { type: "string", maxLength: 100 }, "Ikeja"),
  ],
  "GET /chat/conversations/{id}/messages": [
    query("limit", "Maximum messages returned.", { type: "integer", minimum: 1, maximum: 100, default: 50 }, 50),
    query("before", "Return messages created before this timestamp.", { type: "string", format: "date-time" }, createdAt),
  ],
  "GET /notifications": [
    ...paginationQuery.slice(0, 2),
    query("type", "Filter by notification type.", { type: "string", maxLength: 60 }, "ticket_confirmed"),
    query("unread", "Use true to return unread notifications only.", { type: "string", enum: ["true", "false"] }, "true"),
  ],
  "GET /disputes": [query("status", "Filter by dispute status.", { type: "string", enum: ["open", "under_review", "awaiting_user", "resolved", "closed"] }, "open")],
  "GET /wallet/transactions": [
    ...paginationQuery.slice(0, 2),
    query("type", "Filter by ledger type.", { type: "string", enum: ["topup", "internal_transfer", "withdrawal", "ticket_purchase", "community_purchase", "refund", "adjustment"] }, "topup"),
    query("status", "Filter by transaction status.", { type: "string", enum: ["pending", "processing", "successful", "failed", "reversed"] }, "successful"),
    query("direction", "Filter credits or debits.", { type: "string", enum: ["credit", "debit"] }, "credit"),
  ],
};

export const successContracts: Record<string, SuccessContract> = {
  "GET /locations/search": ok("Location suggestions loaded.", {
    results: [{
      id: "provider-result-id",
      name: "Eko Hotel & Suites",
      label: "Eko Hotel & Suites, Victoria Island, Lagos, Nigeria",
      address: "Victoria Island, Lagos, Nigeria",
      latitude: 6.4281,
      longitude: 3.4219,
      state: "Lagos",
      localArea: "Eti-Osa",
    }],
    attribution: "Powered by Geoapify · © OpenStreetMap contributors",
  }),
  "POST /auth/register": ok("Account created. Check your email for the verification code.", { userId: id, email: "ada@example.com" }, 201),
  "POST /auth/verify-email": ok("Email verified", { user: profileUser, session }),
  "POST /auth/resend-verification": ok("If the account requires verification, a new code has been sent."),
  "POST /auth/login": ok("Signed in", { user: profileUser, session }),
  "POST /auth/refresh": ok("Session refreshed", { session }),
  "POST /auth/logout": ok("Signed out"),
  "POST /auth/forgot-password": ok("If the account exists, a password reset code has been sent."),
  "POST /auth/reset-password": ok("Password reset. Sign in with your new password."),

  "GET /users/me": ok("Profile retrieved", { user: profileUser, totals: profileTotals }),
  "PATCH /users/me": ok("Profile updated", { user: profileUser }),
  "PATCH /users/me/avatar": ok("Profile photo updated", { user: { ...profileUser, avatarUrl: "https://res.cloudinary.com/example/image/upload/v1784370000/avatars/example.webp" } }),
  "PATCH /users/me/password": ok("Password changed. Sign in again on your devices."),
  "POST /users/me/push-tokens": ok("Push token registered"),
  "DELETE /users/me/push-tokens": ok("Push token removed"),
  "DELETE /users/me": ok("Account deleted"),
  "POST /users/{id}/reports": ok("Report submitted", { report: { ...report, targetType: "user" } }, 201),

  "GET /users/me/communities": ok("My communities retrieved", { communities: [{ ...community, coverImageUrl: community.imageUrl, avatarImageUrl: community.imageUrl, memberCount: 8, viewerMembership: { role: "member", status: "active", joinedAt: createdAt, muted: false }, unreadCount: 2, lastActivityAt: createdAt }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
  "GET /communities/{id}/rules": ok("Community rules retrieved", { rules: { communityId: id, introduction: "Keep the community welcoming and useful.", rules: [{ _id: secondId, title: "Be respectful", description: "Treat every member with respect.", order: 0 }], consequences: ["Repeated violations may result in removal."], updatedAt: createdAt, updatedBy: secondUser } }),
  "PUT /communities/{id}/rules": ok("Community rules retrieved", { rules: { communityId: id, introduction: "Keep the community welcoming and useful.", rules: [], consequences: [], updatedAt: createdAt, updatedBy: user } }),
  "GET /communities/{id}/settings": ok("Community settings retrieved", { settings: { joinPolicy: "approval", messagePermission: "moderators", membersCanCreatePosts: true, membersCanInvite: false, showMemberList: true } }),
  "PATCH /communities/{id}/settings": ok("Community settings updated", { settings: { joinPolicy: "approval", messagePermission: "moderators", membersCanCreatePosts: true, membersCanInvite: false, showMemberList: true } }),
  "PATCH /communities/{id}/members/{userId}": ok("Community member updated", { member: { user: secondUser, communityRole: "moderator", status: "active", joinedAt: createdAt } }),
  "DELETE /communities/{id}/members/{userId}": ok("Community member removed", { removedUserId: secondId }),
  "PUT /communities/{id}/bans/{userId}": ok("Community member banned", { userId: secondId, status: "banned", reason: "Repeated harassment in community messages.", expiresAt: "2026-12-31T23:59:59.000Z" }),
  "DELETE /communities/{id}/bans/{userId}": ok("Community member unbanned", { userId: secondId, status: "removed" }),
  "POST /communities/{id}/join-requests": ok("Community join request created", { joinRequest: { _id: id, communityId: secondId, requesterId: user, message: "I would like to join the community.", status: "pending", createdAt } }, 201),
  "GET /communities/{id}/join-requests": ok("Community join requests retrieved", { joinRequests: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  "PATCH /communities/{id}/join-requests/{requestId}": ok("Community join request reviewed", { joinRequest: { _id: id, status: "approved" }, member: { user: user, communityRole: "member", status: "active", joinedAt: createdAt } }),
  "DELETE /communities/{id}/join-requests/me": ok("Community join request cancelled", { joinRequestId: id, status: "cancelled" }),
  "POST /communities/{id}/invites": ok("Community invite created", { invite: { _id: id, token: "short-lived-invite-token", expiresAt: "2026-12-31T23:59:59.000Z", maxUses: 10 } }, 201),
  "POST /communities/{id}/calls": ok("Community call started", { call: { _id: id, communityId: secondId, type: "video", status: "active", startedBy: id, participantCount: 0, startedAt: createdAt, endedAt: null } }, 201),
  "GET /communities/{id}/calls/active": ok("Active community call retrieved", { call: { _id: id, communityId: secondId, type: "voice", status: "active", startedBy: secondId, participantCount: 4, startedAt: createdAt, endedAt: null } }),
  "POST /communities/{id}/calls/{callId}/join": ok("Community call credentials created", { call: { _id: id, communityId: secondId, type: "video", status: "active", startedBy: secondId, participantCount: 4, startedAt: createdAt, endedAt: null }, provider: "livekit", roomName: "community-example", participantToken: "server-issued-short-lived-token", expiresAt: "2026-07-18T09:40:00.000Z" }),
  "DELETE /communities/{id}/calls/{callId}": ok("Community call ended", { call: { _id: id, communityId: secondId, type: "voice", status: "ended", startedBy: secondId, participantCount: 0, startedAt: createdAt, endedAt: "2026-07-18T10:30:00.000Z" } }),
  "PUT /communities/{id}/messages/read": ok("Community messages marked read", { communityId: id, lastReadMessageId: secondId, lastReadAt: createdAt, unreadCount: 0 }),
  "PATCH /communities/{id}/notification-preferences/me": ok("Community notification preference updated", { communityId: id, level: "mentions", updatedAt: createdAt }),
  "PATCH /communities/{id}/announcements/{announcementId}": ok("Community announcement updated", { announcement: communityAnnouncement }),
  "DELETE /communities/{id}/announcements/{announcementId}": ok("Community announcement deleted", { announcementId: id, deletedAt: createdAt }),
  "PATCH /communities/{id}/messages/{messageId}": ok("Community message updated", { message: communityMessage }),
  "DELETE /communities/{id}/messages/{messageId}": ok("Community message deleted", { messageId: id, deletedAt: createdAt }),
  "PUT /communities/{id}/messages/{messageId}/reactions/{emoji}": ok("Community message reactions updated", { messageId: id, reactions: [{ emoji: "👍", count: 2, reactedByViewer: true }] }),
  "DELETE /communities/{id}/messages/{messageId}/reactions/{emoji}": ok("Community message reactions updated", { messageId: id, reactions: [{ emoji: "👍", count: 1, reactedByViewer: false }] }),
  "PUT /communities/{id}/messages/{messageId}/pin": ok("Community message pinned", { message: communityMessage }),
  "DELETE /communities/{id}/messages/{messageId}/pin": ok("Community message unpinned", { message: communityMessage }),
  "PATCH /communities/{id}/posts/{postId}": ok("Community post updated", { post: communityPost }),
  "DELETE /communities/{id}/posts/{postId}": ok("Community post deleted", { postId: id, deletedAt: createdAt }),
  "POST /communities/{id}/messages/{messageId}/reports": ok("Community message reported", { report: { _id: id, targetType: "community_message", targetId: secondId, status: "open", createdAt } }, 201),  "POST /communities/{id}/ownership-transfer": ok("Community ownership transferred", { communityId: id, previousOwnerId: id, newOwnerId: secondId, transferredAt: createdAt }),
  "GET /events": ok("Events retrieved", { events: [event], sort: "soonest", pagination: { page: 1, limit: 20, total: 1 } }),
  "GET /events/recommended": ok("Personalized upcoming events retrieved", { events: [{ ...event, hasTicket: true, distanceKm: 4.8, recommendationScore: 0.91, recommendationReasons: ["You have a ticket", "Matches your interests"] }], locationUsed: { latitude: 6.5244, longitude: 3.3792 } }),
  "GET /events/created/me": ok("Created events retrieved", { events: [event] }),
  "GET /events/{id}": ok("Event retrieved", { event, ticketTypes: [ticketType] }),
  "POST /events": ok("Event draft created", { event: { ...event, status: "draft" } }, 201),
  "PATCH /events/{id}": ok("Event updated", { event: { ...event, title: "Updated Lagos Tech Meetup 2026", status: "draft" } }),
  "POST /events/{id}/orders": {
    ...ok("Ticket checkout initialized", {
      order: { ...orderBase, status: "pending" },
      checkoutUrl: "https://checkout.paystack.com/example",
      accessCode: "example_access_code",
      publicKey: "pk_test_example",
      charge: { ticketSubtotalKobo: 500000, platformFeeKobo: 25000, totalPayableKobo: 525000 },
    }, 201),
    examples: {
      paystackCheckout: {
        summary: "Paid ticket order awaiting payment",
        value: {
          success: true,
          message: "Ticket checkout initialized",
          data: {
            order: { ...orderBase, status: "pending" },
            checkoutUrl: "https://checkout.paystack.com/example",
            accessCode: "example_access_code",
            publicKey: "pk_test_example",
            charge: { ticketSubtotalKobo: 500000, platformFeeKobo: 25000, totalPayableKobo: 525000 },
          },
        },
      },
      freeTicket: {
        summary: "Free ticket issued immediately",
        value: {
          success: true,
          message: "Free ticket issued",
          data: { order: { ...orderBase, totalKobo: 0, ticketSubtotalKobo: 0, platformFeeKobo: 0, organizerProceedsKobo: 0, status: "paid" }, qrToken: "opaque-ticket-token-at-least-thirty-two-characters" },
        },
      },
    },
  },
  "POST /events/{id}/publish": ok("Event approved and published", { event }),
  "POST /events/{id}/cancel": ok("Event cancelled", { event: { ...event, status: "cancelled" } }),
  "DELETE /events/{id}": ok("Event draft deleted"),
  "POST /events/{id}/ticket-types": ok("Ticket type created", { ticketType }, 201),
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": ok("Ticket type updated", { ticketType: { ...ticketType, title: "Early Bird" } }),
  "DELETE /events/{id}/ticket-types/{ticketTypeId}": ok("Ticket type removed"),
  "GET /events/{id}/attendees": ok("Attendees retrieved", { attendees: [attendeeOrder], summary: { orders: 1, totalTickets: 1, checkedInTickets: 1, pendingTickets: 0 } }),
  "POST /events/{id}/check-ins": ok("Ticket checked in", { order: { ...orderBase, checkedInAt: createdAt } }),
  "POST /events/{id}/reports": ok("Report submitted", { report }, 201),

  "GET /communities": ok("Communities retrieved", { communities: [community], pagination: { page: 1, limit: 20, total: 1 } }),
  "GET /communities/{id}": ok("Community retrieved", { community }),
  "POST /communities": ok("Community created", { community }, 201),
  "PATCH /communities/{id}": ok("Community updated", { community: { ...community, membershipPriceKobo: 250000 } }),
  "POST /communities/{id}/members": ok("Community joined"),
  "POST /communities/{id}/membership-orders": ok("Community membership checkout initialized", { order: { orderNumber: "CCM-1784370000000-A1B2C3D4", communityId: id, grossAmountKobo: 200000, platformFeeKobo: 10000, ownerProceedsKobo: 190000, status: "pending" }, checkoutUrl: "https://checkout.paystack.com/example", accessCode: "example_access_code", publicKey: "pk_test_example", charge: { grossAmountKobo: 200000, platformFeeKobo: 10000, ownerProceedsKobo: 190000 } }, 201),
  "GET /communities/membership-orders/{orderNumber}/verify": ok("Community membership verified", { order: { orderNumber: "CCM-1784370000000-A1B2C3D4", communityId: community, status: "paid", paidAt: createdAt } }),
  "DELETE /communities/{id}/members/me": ok("Community left"),
  "GET /communities/{id}/members": ok("Community members retrieved", { members: [user] }),
  "GET /communities/{id}/posts": ok("Community posts retrieved", { posts: [communityPost], pagination: { page: 1, limit: 20, total: 1 } }),
  "POST /communities/{id}/posts": ok("Community post created", { post: communityPost }, 201),
  "GET /communities/{id}/announcements": ok("Community announcements retrieved", { announcements: [communityAnnouncement], pagination: { page: 1, limit: 20, total: 1 } }),
  "POST /communities/{id}/announcements": ok("Community announcement created", { announcement: communityAnnouncement }, 201),
  "GET /communities/{id}/messages": ok("Community messages retrieved", { messages: [communityMessage], pagination: { page: 1, limit: 20, total: 1 } }),
  "POST /communities/{id}/messages": ok("Community message sent", { message: communityMessage }, 201),
  "POST /communities/{id}/reports": ok("Report submitted", { report: { ...report, targetType: "community" } }, 201),

  "GET /friends": ok("Friends retrieved", { friendships: [{ ...friendship, status: "accepted" }] }),
  "GET /friends/requests": ok("Friend requests retrieved", { requests: [friendship] }),
  "GET /friends/suggestions": ok("Friend suggestions retrieved", { users: [user] }),
  "POST /friends/requests/{userId}": ok("Friend request sent", { friendship }, 201),
  "PATCH /friends/requests/{id}": ok("Friend request accepted", { friendship: { ...friendship, status: "accepted" } }),
  "DELETE /friends/{id}": ok("Friend removed"),

  "GET /chat/conversations": ok("Conversations retrieved", { conversations: [conversation] }),
  "POST /chat/conversations": ok("Conversation created", { conversation }, 201),
  "GET /chat/conversations/{id}/messages": ok("Messages retrieved", { messages: [message] }),
  "POST /chat/conversations/{id}/messages": ok("Message sent", { message }, 201),
  "POST /chat/conversations/{id}/read": ok("Conversation marked as read"),

  "POST /ai/chat": ok("AI response generated", { sessionId: id, message: "Here are nearby technology events that match your interests." }),
  "POST /ai/event-copy": ok("Event copy generated", { sessionId: id, message: "Lagos Tech Meetup 2026 â€” practical talks and meaningful networking for builders." }),
  "POST /ai/event-recommendations": ok("Personalized event recommendations generated", { events: [{ ...event, distanceKm: 4.8, recommendationScore: 0.91 }] }),
  "POST /ai/conversations/{id}/summary": ok("Conversation summarized", { sessionId: id, message: "The participants agreed to attend the meetup and meet at the entrance." }),
  "GET /ai/sessions": ok("AI sessions retrieved", { sessions: [{ _id: id, purpose: "assistant", lastUsedAt: createdAt }] }),
  "DELETE /ai/sessions/{id}": ok("AI session deleted"),

  "GET /tickets": ok("Tickets retrieved", { tickets: [order] }),
  "GET /tickets/{orderNumber}": ok("Ticket retrieved", { order, qrToken: "opaque-ticket-token-at-least-thirty-two-characters" }),
  "GET /tickets/{orderNumber}/verify": ok("Ticket retrieved", { order, qrToken: "opaque-ticket-token-at-least-thirty-two-characters" }),

  "GET /notifications": ok("Notifications retrieved", { notifications: [notification], unread: 1, pagination: { page: 1, limit: 20, total: 1 } }),
  "PATCH /notifications/read-all": ok("All notifications marked as read"),
  "PATCH /notifications/{id}/read": ok("Notification marked as read", { notification: { ...notification, readAt: createdAt } }),

  "POST /disputes": ok("Dispute submitted", { dispute }, 201),
  "GET /disputes": ok("Disputes retrieved", { disputes: [dispute] }),
  "GET /disputes/{id}": ok("Dispute retrieved", { dispute }),
  "POST /disputes/{id}/messages": ok("Dispute reply added", { dispute: { ...dispute, messages: [disputeMessage] } }, 201),
  "PATCH /disputes/{id}/status": ok("Dispute status updated", { dispute: { ...dispute, status: "resolved", resolution: "Payment reconciled and the ticket was issued." } }),

  "GET /wallet": ok("Wallet retrieved", { wallet }),
  "GET /wallet/transactions": ok("Transactions retrieved", { transactions: [transaction], pagination: { page: 1, limit: 20, total: 1 } }),
  "GET /wallet/transactions/{id}": ok("Transaction retrieved", { transaction }),
  "POST /wallet/topups": ok("Top-up initialized", { transaction, authorizationUrl: "https://checkout.paystack.com/example", accessCode: "example_access_code", reference: transaction.reference, publicKey: "pk_test_example", charge: { walletCreditKobo: 100000, feeKobo: 1000, totalPayableKobo: 101000 } }, 201),
  "GET /wallet/topups/{reference}/verify": ok("Top-up verified", { transaction: { ...transaction, status: "successful", completedAt: createdAt } }),
  "GET /wallet/banks": ok("Banks retrieved", { banks: [{ name: "Guaranty Trust Bank", code: "058", active: true, country: "Nigeria", currency: "NGN" }] }),
  "GET /wallet/bank-accounts": ok("Bank accounts retrieved", { bankAccounts: [{ _id: id, bankName: "Guaranty Trust Bank", bankCode: "058", accountName: "ADA OKAFOR", maskedAccountNumber: "******6789", active: true }] }),
  "POST /wallet/bank-accounts": ok("Bank account saved", { bankAccount: { _id: id, bankName: "Guaranty Trust Bank", bankCode: "058", accountName: "ADA OKAFOR", maskedAccountNumber: "******6789", active: true } }, 201),
  "DELETE /wallet/bank-accounts/{id}": ok("Bank account removed"),
  "POST /wallet/transfers": ok("Transfer completed", { transaction: { ...transaction, reference: "transfer_550e8400-e29b-41d4-a716-446655440000", type: "internal_transfer", direction: "debit", amountKobo: 50000, feeKobo: 0, status: "successful" } }, 201),
  "POST /wallet/withdrawals": ok("Withdrawal submitted", { transaction: { ...transaction, reference: "withdrawal_550e8400-e29b-41d4-a716-446655440000", type: "withdrawal", direction: "debit", amountKobo: 100000, feeKobo: 1000, status: "processing" }, charge: { withdrawalAmountKobo: 100000, feeKobo: 1000, payoutAmountKobo: 99000 } }, 202),
  "POST /wallet/withdrawals/{reference}/finalize": ok("Withdrawal OTP accepted", { transaction: { ...transaction, type: "withdrawal", status: "processing" } }, 202),

  "POST /uploads/files": ok("Community file uploaded", { attachment: { _id: id, url: "https://res.cloudinary.com/example/raw/upload/community-chat/example.pdf", type: "pdf", name: "meeting-notes.pdf", mimeType: "application/pdf", sizeBytes: 184320, thumbnailUrl: null } }, 201),
  "POST /uploads/images": ok("Image uploaded", { url: "https://res.cloudinary.com/example/image/upload/v1784370000/events/example.webp", publicId: "events/example", width: 1600, height: 900, format: "webp", bytes: 184320 }, 201),
  "POST /webhooks/paystack": { status: 200, description: "Webhook accepted", example: { received: true } },
};

export const pathParameterExamples: Record<string, { description: string; example: string; schema?: OpenApiSchema }> = {
  id: { description: "MongoDB resource identifier.", example: id, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  userId: { description: "MongoDB user identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  requestId: { description: "MongoDB community join-request identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  callId: { description: "MongoDB community-call identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  messageId: { description: "MongoDB message identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  postId: { description: "MongoDB community-post identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  announcementId: { description: "MongoDB announcement identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  ticketTypeId: { description: "MongoDB ticket-type identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  emoji: { description: "Message reaction emoji or short reaction text.", example: "👍", schema: { type: "string", minLength: 1, maxLength: 32 } },
  orderNumber: { description: "Server-generated order number.", example: "CC-1784370000000-A1B2C3D4", schema: { type: "string", minLength: 12, maxLength: 80 } },
  reference: { description: "Server-generated payment or transfer reference.", example: "topup_550e8400-e29b-41d4-a716-446655440000", schema: { type: "string", minLength: 16, maxLength: 80 } },
};
