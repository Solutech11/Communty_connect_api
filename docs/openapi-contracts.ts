export type OpenApiSchema = Record<string, unknown>;

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
}

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
  createdAt,
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
  maxCapacity: 250,
  tags: ["technology", "networking"],
  status: "published",
  createdAt,
};

const ticketType = {
  _id: secondId,
  eventId: id,
  title: "General Admission",
  description: "Standard event access",
  priceKobo: 500000,
  capacity: 200,
  sold: 10,
  reserved: 1,
  active: true,
};

const order = {
  _id: id,
  orderNumber: "CC-1784370000000-A1B2C3D4",
  eventId: event,
  ticketTypeId: ticketType,
  quantity: 1,
  ticketSubtotalKobo: 500000,
  platformFeeKobo: 25000,
  totalKobo: 525000,
  status: "paid",
  createdAt,
};

const community = {
  _id: id,
  ownerId: secondId,
  name: "Lagos Product Builders",
  slug: "lagos-product-builders-a1b2c3",
  description: "A community for product designers, engineers, and founders in Lagos.",
  category: "Technology",
  state: "Lagos",
  lga: "Ikeja",
  visibility: "public",
  membershipType: "premium",
  membershipPriceKobo: 200000,
  members: [secondId],
  createdAt,
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
  lastMessageAt: createdAt,
};

const message = {
  _id: id,
  conversationId: secondId,
  senderId: id,
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

const dispute = {
  _id: id,
  userId: secondId,
  category: "payment",
  subject: "Ticket payment needs review",
  description: "My payment succeeded but the ticket was not immediately visible.",
  status: "open",
  messages: [],
  createdAt,
};

const friendship = {
  _id: id,
  requesterId: secondId,
  addresseeId: id,
  status: "pending",
  createdAt,
};

const inferSchema = (value: unknown): OpenApiSchema => {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length > 0 ? inferSchema(value[0]) : {} };
  }

  if (value !== null && typeof value === "object") {
    const properties = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, inferSchema(item)]),
    );
    return { type: "object", additionalProperties: false, properties };
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
  "POST /auth/register": jsonBody({ firstName: "Ada", lastName: "Okafor", email: "ada@example.com", password: "StrongPass1!", phone: "+2348012345678" }, ["firstName", "lastName", "email", "password"]),
  "POST /auth/verify-email": jsonBody({ email: "ada@example.com", otp: "123456" }, ["email", "otp"]),
  "POST /auth/resend-verification": jsonBody({ email: "ada@example.com" }, ["email"]),
  "POST /auth/login": jsonBody({ email: "ada@example.com", password: "StrongPass1!" }, ["email", "password"]),
  "POST /auth/refresh": jsonBody({ refreshToken }, ["refreshToken"]),
  "POST /auth/logout": jsonBody({ refreshToken }, ["refreshToken"]),
  "POST /auth/forgot-password": jsonBody({ email: "ada@example.com" }, ["email"]),
  "POST /auth/reset-password": jsonBody({ email: "ada@example.com", otp: "123456", newPassword: "NewStrongPass2!" }, ["email", "otp", "newPassword"]),

  "PATCH /users/me": jsonBody({ firstName: "Ada", lastName: "Okafor", phone: "+2348012345678", bio: "Community organizer and product designer.", avatarUrl: "https://res.cloudinary.com/example/avatar.webp", country: "Nigeria", state: "Lagos", lga: "Ikeja", location: { type: "Point", coordinates: [3.3792, 6.5244] }, interests: ["technology", "music"] }, [], "Send at least one profile field. GeoJSON coordinates are [longitude, latitude]."),
  "PATCH /users/me/password": jsonBody({ currentPassword: "StrongPass1!", newPassword: "NewStrongPass2!" }, ["currentPassword", "newPassword"]),
  "POST /users/me/push-tokens": jsonBody({ token: "ExponentPushToken[example_device_token]" }, ["token"]),
  "DELETE /users/me/push-tokens": jsonBody({ token: "ExponentPushToken[example_device_token]" }, ["token"]),
  "DELETE /users/me": jsonBody({ password: "StrongPass1!" }, ["password"]),

  "POST /events": jsonBody({ title: "Lagos Tech Meetup 2026", description: "An evening of practical talks, networking, and community building.", coverImageUrl: "https://res.cloudinary.com/example/event.webp", activityType: "Technology", targetAudience: "Developers and founders", setting: "indoor", country: "Nigeria", state: "Lagos", lga: "Ikeja", venueName: "Community Hall", address: "12 Example Street, Ikeja", coordinates: { type: "Point", coordinates: [3.3792, 6.5244] }, startsAt: "2026-09-20T16:00:00.000Z", endsAt: "2026-09-20T20:00:00.000Z", timezone: "Africa/Lagos", contactPhone: "+2348012345678", maxCapacity: 250, tags: ["technology", "networking"] }, ["title", "description", "activityType", "setting", "state", "lga", "venueName", "address", "startsAt", "endsAt", "maxCapacity"]),
  "PATCH /events/{id}": jsonBody({ title: "Updated Lagos Tech Meetup 2026", description: "Updated event description with enough information for attendees.", startsAt: "2026-09-20T17:00:00.000Z", endsAt: "2026-09-20T21:00:00.000Z", maxCapacity: 300 }, [], "Send at least one event field. If both dates are sent, endsAt must be later than startsAt."),
  "POST /events/{id}/orders": jsonBody({ ticketTypeId: secondId, quantity: 1 }, ["ticketTypeId", "quantity"]),
  "POST /events/{id}/ticket-types": jsonBody({ title: "General Admission", description: "Standard event access", priceKobo: 500000, capacity: 200 }, ["title", "priceKobo"]),
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": jsonBody({ title: "Early Bird", description: "Discounted early access", priceKobo: 400000, capacity: 100 }, [], "Send at least one ticket-type field."),
  "POST /events/{id}/check-ins": jsonBody({ qrToken: "opaque-ticket-token-at-least-thirty-two-characters" }, ["qrToken"]),

  "POST /communities": jsonBody({ name: "Lagos Product Builders", description: "A community for product designers, engineers, and founders in Lagos.", imageUrl: "https://res.cloudinary.com/example/community.webp", category: "Technology", state: "Lagos", lga: "Ikeja", visibility: "public", membershipType: "premium", membershipPriceKobo: 200000 }, ["name", "description", "category"]),
  "PATCH /communities/{id}": jsonBody({ description: "Updated community description for product builders across Lagos.", membershipType: "premium", membershipPriceKobo: 250000 }, [], "Send at least one community field. Premium communities require a positive membershipPriceKobo."),

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

  "POST /uploads/images": {
    contentType: "multipart/form-data",
    description: "One JPEG, PNG, or WebP image plus an optional destination folder.",
    schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" }, folder: { type: "string", enum: ["avatars", "events", "communities", "disputes", "chat", "uploads"], default: "uploads" } } },
    example: { folder: "events", image: "(binary file)" },
  },
  "POST /webhooks/paystack": jsonBody({ event: "charge.success", data: { id: 123456789, reference: "topup_550e8400-e29b-41d4-a716-446655440000", amount: 101000, status: "success" } }, ["event", "data"], "Signed Paystack payload. Paystack must supply x-paystack-signature; clients must not call this endpoint."),
};

export const queryParameterContracts: Record<string, QueryParameterContract[]> = {
  "GET /events": [
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
  "POST /auth/register": ok("Account created. Check your email for the verification code.", { userId: id, email: "ada@example.com" }, 201),
  "POST /auth/verify-email": ok("Email verified", { user, session }),
  "POST /auth/resend-verification": ok("If the account requires verification, a new code has been sent."),
  "POST /auth/login": ok("Signed in", { user, session }),
  "POST /auth/refresh": ok("Session refreshed", { session }),
  "POST /auth/logout": ok("Signed out"),
  "POST /auth/forgot-password": ok("If the account exists, a password reset code has been sent."),
  "POST /auth/reset-password": ok("Password reset. Sign in with your new password."),

  "GET /users/me": ok("Profile retrieved", { user }),
  "PATCH /users/me": ok("Profile updated", { user: { ...user, bio: "Community organizer and product designer." } }),
  "PATCH /users/me/password": ok("Password changed. Sign in again on your devices."),
  "POST /users/me/push-tokens": ok("Push token registered"),
  "DELETE /users/me/push-tokens": ok("Push token removed"),
  "DELETE /users/me": ok("Account deleted"),

  "GET /events": ok("Events retrieved", { events: [event], sort: "soonest", pagination: { page: 1, limit: 20, total: 1 } }),
  "GET /events/recommended": ok("Personalized nearby events retrieved", { events: [{ ...event, distanceKm: 4.8, recommendationScore: 0.91 }], locationUsed: { latitude: 6.5244, longitude: 3.3792 } }),
  "GET /events/created/me": ok("Created events retrieved", { events: [event] }),
  "GET /events/{id}": ok("Event retrieved", { event, ticketTypes: [ticketType] }),
  "POST /events": ok("Event draft created", { event: { ...event, status: "draft" } }, 201),
  "PATCH /events/{id}": ok("Event updated", { event: { ...event, title: "Updated Lagos Tech Meetup 2026", status: "draft" } }),
  "POST /events/{id}/orders": ok("Ticket checkout initialized", { order: { ...order, status: "pending" }, checkoutUrl: "https://checkout.paystack.com/example", accessCode: "example_access_code", publicKey: "pk_test_example", charge: { ticketSubtotalKobo: 500000, platformFeeKobo: 25000, totalPayableKobo: 525000 } }, 201),
  "POST /events/{id}/publish": ok("Event submitted for admin approval", { event: { ...event, status: "pending_approval" } }),
  "POST /events/{id}/cancel": ok("Event cancelled", { event: { ...event, status: "cancelled" } }),
  "DELETE /events/{id}": ok("Event draft deleted"),
  "POST /events/{id}/ticket-types": ok("Ticket type created", { ticketType }, 201),
  "PATCH /events/{id}/ticket-types/{ticketTypeId}": ok("Ticket type updated", { ticketType: { ...ticketType, title: "Early Bird" } }),
  "DELETE /events/{id}/ticket-types/{ticketTypeId}": ok("Ticket type removed"),
  "GET /events/{id}/attendees": ok("Attendees retrieved", { attendees: [{ ...order, buyerId: user }] }),
  "POST /events/{id}/check-ins": ok("Ticket checked in", { order: { ...order, checkedInAt: createdAt } }),

  "GET /communities": ok("Communities retrieved", { communities: [community], pagination: { page: 1, limit: 20, total: 1 } }),
  "GET /communities/{id}": ok("Community retrieved", { community }),
  "POST /communities": ok("Community created", { community }, 201),
  "PATCH /communities/{id}": ok("Community updated", { community: { ...community, membershipPriceKobo: 250000 } }),
  "POST /communities/{id}/members": ok("Community joined"),
  "POST /communities/{id}/membership-orders": ok("Community membership checkout initialized", { order: { orderNumber: "CCM-1784370000000-A1B2C3D4", communityId: id, grossAmountKobo: 200000, platformFeeKobo: 10000, ownerProceedsKobo: 190000, status: "pending" }, checkoutUrl: "https://checkout.paystack.com/example", accessCode: "example_access_code", publicKey: "pk_test_example", charge: { grossAmountKobo: 200000, platformFeeKobo: 10000, ownerProceedsKobo: 190000 } }, 201),
  "GET /communities/membership-orders/{orderNumber}/verify": ok("Community membership verified", { order: { orderNumber: "CCM-1784370000000-A1B2C3D4", communityId: community, status: "paid", paidAt: createdAt } }),
  "DELETE /communities/{id}/members/me": ok("Community left"),
  "GET /communities/{id}/members": ok("Community members retrieved", { members: [user] }),

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
  "POST /ai/event-copy": ok("Event copy generated", { sessionId: id, message: "Lagos Tech Meetup 2026 — practical talks and meaningful networking for builders." }),
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
  "POST /disputes/{id}/messages": ok("Dispute reply added", { dispute: { ...dispute, messages: [{ senderId: id, message: "The ticket is still unavailable in my account.", createdAt }] } }, 201),
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

  "POST /uploads/images": ok("Image uploaded", { url: "https://res.cloudinary.com/example/image/upload/v1784370000/events/example.webp", publicId: "events/example", width: 1600, height: 900, format: "webp", bytes: 184320 }, 201),
  "POST /webhooks/paystack": { status: 200, description: "Webhook accepted", example: { received: true } },
};

export const pathParameterExamples: Record<string, { description: string; example: string; schema?: OpenApiSchema }> = {
  id: { description: "MongoDB resource identifier.", example: id, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  userId: { description: "MongoDB user identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  ticketTypeId: { description: "MongoDB ticket-type identifier.", example: secondId, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
  orderNumber: { description: "Server-generated order number.", example: "CC-1784370000000-A1B2C3D4", schema: { type: "string" } },
  reference: { description: "Server-generated payment or transfer reference.", example: "topup_550e8400-e29b-41d4-a716-446655440000", schema: { type: "string", minLength: 16, maxLength: 80 } },
};
