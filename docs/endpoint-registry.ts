export type HttpMethod = "get" | "post" | "patch" | "delete";

export interface EndpointDefinition {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description: string;
  auth: boolean;
  roles?: string[];
  idempotency?: boolean;
  requestBody?: boolean;
}

export const apiEndpoints: EndpointDefinition[] = [
  { method: "post", path: "/auth/register", tag: "Auth", summary: "Register an account", description: "Creates a pending member, wallet, and one-time email verification code.", auth: false, requestBody: true },
  { method: "post", path: "/auth/verify-email", tag: "Auth", summary: "Verify email", description: "Verifies the six-digit email code and creates an access/refresh token session.", auth: false, requestBody: true },
  { method: "post", path: "/auth/resend-verification", tag: "Auth", summary: "Resend verification code", description: "Issues a replacement verification code without revealing account existence.", auth: false, requestBody: true },
  { method: "post", path: "/auth/login", tag: "Auth", summary: "Sign in", description: "Authenticates an active verified user and creates a token session.", auth: false, requestBody: true },
  { method: "post", path: "/auth/refresh", tag: "Auth", summary: "Rotate refresh token", description: "Rotates a valid refresh token; reuse revokes its entire token family.", auth: false, requestBody: true },
  { method: "post", path: "/auth/logout", tag: "Auth", summary: "Sign out", description: "Revokes the supplied refresh token for the authenticated user.", auth: true, requestBody: true },
  { method: "post", path: "/auth/forgot-password", tag: "Auth", summary: "Request password reset", description: "Emails a short-lived reset code without revealing whether the account exists.", auth: false, requestBody: true },
  { method: "post", path: "/auth/reset-password", tag: "Auth", summary: "Reset password", description: "Consumes a reset code, changes the password, and revokes every active session.", auth: false, requestBody: true },

  { method: "get", path: "/users/me", tag: "Users", summary: "Get my profile", description: "Returns the authenticated user's safe profile fields.", auth: true },
  { method: "patch", path: "/users/me", tag: "Users", summary: "Update my profile", description: "Updates allowlisted profile fields only.", auth: true, requestBody: true },
  { method: "patch", path: "/users/me/password", tag: "Users", summary: "Change password", description: "Verifies the current password, changes it, and revokes all sessions.", auth: true, requestBody: true },
  { method: "post", path: "/users/me/push-tokens", tag: "Users", summary: "Register Expo push token", description: "Adds a validated Expo push token to the signed-in account.", auth: true, requestBody: true },
  { method: "delete", path: "/users/me/push-tokens", tag: "Users", summary: "Remove Expo push token", description: "Removes a device push token from the signed-in account.", auth: true, requestBody: true },
  { method: "delete", path: "/users/me", tag: "Users", summary: "Delete my account", description: "Requires password confirmation, anonymizes the account, and revokes sessions.", auth: true, requestBody: true },

  { method: "get", path: "/events", tag: "Events", summary: "List published events", description: "Returns searchable upcoming published events with location filters.", auth: false },
  { method: "get", path: "/events/created/me", tag: "Events", summary: "List my created events", description: "Returns every event created by the signed-in user.", auth: true },
  { method: "get", path: "/events/{id}", tag: "Events", summary: "Get event", description: "Returns an event and active ticket types; drafts are owner-only.", auth: false },
  { method: "post", path: "/events", tag: "Events", summary: "Create event draft", description: "Creates a validated event in draft state.", auth: true, requestBody: true },
  { method: "patch", path: "/events/{id}", tag: "Events", summary: "Update event draft", description: "Updates a draft owned by the signed-in user.", auth: true, requestBody: true },
  { method: "post", path: "/events/{id}/orders", tag: "Tickets", summary: "Initialize ticket order", description: "Reserves server-priced inventory, creates an audit ledger entry, and initializes Paystack or immediately issues a free ticket.", auth: true, idempotency: true, requestBody: true },
  { method: "post", path: "/events/{id}/publish", tag: "Events", summary: "Publish event", description: "Publishes an owned draft after date and ticket checks.", auth: true },
  { method: "post", path: "/events/{id}/cancel", tag: "Events", summary: "Cancel event", description: "Cancels an event owned by the signed-in user.", auth: true },
  { method: "delete", path: "/events/{id}", tag: "Events", summary: "Delete event draft", description: "Deletes only an owned draft and its unsold ticket definitions.", auth: true },
  { method: "post", path: "/events/{id}/ticket-types", tag: "Events", summary: "Add ticket type", description: "Adds one of up to ten ticket types to an owned draft.", auth: true, requestBody: true },
  { method: "patch", path: "/events/{id}/ticket-types/{ticketTypeId}", tag: "Events", summary: "Update ticket type", description: "Updates an unsold ticket type on an owned event.", auth: true, requestBody: true },
  { method: "delete", path: "/events/{id}/ticket-types/{ticketTypeId}", tag: "Events", summary: "Remove ticket type", description: "Deactivates an unsold ticket type on an owned event.", auth: true },
  { method: "get", path: "/events/{id}/attendees", tag: "Events", summary: "List event attendees", description: "Returns paid ticket holders to the event owner.", auth: true },
  { method: "post", path: "/events/{id}/check-ins", tag: "Events", summary: "Check in a ticket", description: "Validates a QR token and atomically records first use for the event owner.", auth: true, requestBody: true },

  { method: "get", path: "/communities", tag: "Communities", summary: "List communities", description: "Lists searchable public communities with category and location filters.", auth: false },
  { method: "get", path: "/communities/{id}", tag: "Communities", summary: "Get community", description: "Returns public community details and moderators.", auth: false },
  { method: "post", path: "/communities", tag: "Communities", summary: "Create community", description: "Creates a community owned by and joined by the authenticated user.", auth: true, requestBody: true },
  { method: "patch", path: "/communities/{id}", tag: "Communities", summary: "Update community", description: "Updates an owned community.", auth: true, requestBody: true },
  { method: "post", path: "/communities/{id}/members", tag: "Communities", summary: "Join community", description: "Adds the signed-in user to a public community.", auth: true },
  { method: "delete", path: "/communities/{id}/members/me", tag: "Communities", summary: "Leave community", description: "Removes the signed-in member; owners must transfer ownership first.", auth: true },
  { method: "get", path: "/communities/{id}/members", tag: "Communities", summary: "List community members", description: "Returns safe member profile fields.", auth: true },

  { method: "get", path: "/friends", tag: "Friends", summary: "List friends", description: "Lists accepted friendships for the signed-in user.", auth: true },
  { method: "get", path: "/friends/requests", tag: "Friends", summary: "List friend requests", description: "Lists pending inbound requests.", auth: true },
  { method: "get", path: "/friends/suggestions", tag: "Friends", summary: "Get friend suggestions", description: "Returns active users excluding the current social graph.", auth: true },
  { method: "post", path: "/friends/requests/{userId}", tag: "Friends", summary: "Send friend request", description: "Creates one unique pending relationship between two users.", auth: true },
  { method: "patch", path: "/friends/requests/{id}", tag: "Friends", summary: "Respond to friend request", description: "Accepts or declines an inbound pending request.", auth: true, requestBody: true },
  { method: "delete", path: "/friends/{id}", tag: "Friends", summary: "Remove friend", description: "Deletes a relationship only when the signed-in user is a participant.", auth: true },

  { method: "get", path: "/chat/conversations", tag: "Chat", summary: "List conversations", description: "Lists conversations in which the signed-in user participates.", auth: true },
  { method: "post", path: "/chat/conversations", tag: "Chat", summary: "Create conversation", description: "Creates a direct, group, or support conversation with validated active members.", auth: true, requestBody: true },
  { method: "get", path: "/chat/conversations/{id}/messages", tag: "Chat", summary: "List messages", description: "Returns cursor-paginated messages after a participant ownership check.", auth: true },
  { method: "post", path: "/chat/conversations/{id}/messages", tag: "Chat", summary: "Send message", description: "Creates an idempotent client message and emits it over Socket.IO.", auth: true, requestBody: true },
  { method: "post", path: "/chat/conversations/{id}/read", tag: "Chat", summary: "Mark conversation read", description: "Marks unread messages as read for the participant and emits a receipt.", auth: true },

  { method: "post", path: "/ai/chat", tag: "AI", summary: "Chat with Community Connect AI", description: "Uses the OpenAI Responses API with a server-owned safety and product prompt.", auth: true, requestBody: true },
  { method: "post", path: "/ai/event-copy", tag: "AI", summary: "Generate event copy", description: "Generates event copy using supplied facts without inventing venue or pricing details.", auth: true, requestBody: true },
  { method: "post", path: "/ai/event-recommendations", tag: "AI", summary: "Recommend events", description: "Ranks only current event records supplied by the server.", auth: true, requestBody: true },
  { method: "post", path: "/ai/conversations/{id}/summary", tag: "AI", summary: "Summarize conversation", description: "Summarizes up to 100 messages only after participant authorization.", auth: true },
  { method: "get", path: "/ai/sessions", tag: "AI", summary: "List AI sessions", description: "Lists AI conversation state owned by the signed-in user.", auth: true },
  { method: "delete", path: "/ai/sessions/{id}", tag: "AI", summary: "Delete AI session", description: "Deletes an AI session owned by the signed-in user.", auth: true },

  { method: "get", path: "/tickets", tag: "Tickets", summary: "List my tickets", description: "Returns ticket orders owned by the signed-in user with event and tier details.", auth: true },
  { method: "get", path: "/tickets/{orderNumber}", tag: "Tickets", summary: "Get my ticket", description: "Returns an owned ticket and decrypts its QR token only after payment confirmation.", auth: true },
  { method: "get", path: "/tickets/{orderNumber}/verify", tag: "Tickets", summary: "Verify ticket payment", description: "Verifies exact Paystack amount server-to-server and atomically converts reserved inventory to sold inventory.", auth: true },

  { method: "get", path: "/notifications", tag: "Notifications", summary: "List notifications", description: "Returns filtered in-app notifications and unread count.", auth: true },
  { method: "patch", path: "/notifications/read-all", tag: "Notifications", summary: "Mark all notifications read", description: "Marks every unread notification owned by the user as read.", auth: true },
  { method: "patch", path: "/notifications/{id}/read", tag: "Notifications", summary: "Mark notification read", description: "Marks one owned notification as read.", auth: true },

  { method: "post", path: "/disputes", tag: "Disputes", summary: "Create dispute", description: "Creates a dispute and verifies any referenced transaction belongs to the user.", auth: true, requestBody: true },
  { method: "get", path: "/disputes", tag: "Disputes", summary: "List disputes", description: "Members see their disputes; admins can review all disputes.", auth: true },
  { method: "get", path: "/disputes/{id}", tag: "Disputes", summary: "Get dispute", description: "Returns a dispute after owner or admin authorization.", auth: true },
  { method: "post", path: "/disputes/{id}/messages", tag: "Disputes", summary: "Reply to dispute", description: "Adds a reply to an open dispute after owner or admin authorization.", auth: true, requestBody: true },
  { method: "patch", path: "/disputes/{id}/status", tag: "Disputes", summary: "Update dispute status", description: "Administrative status and resolution update.", auth: true, roles: ["admin"], requestBody: true },

  { method: "get", path: "/wallet", tag: "Wallet", summary: "Get wallet", description: "Returns balances in integer kobo and wallet status.", auth: true },
  { method: "get", path: "/wallet/transactions", tag: "Wallet", summary: "List wallet transactions", description: "Returns paginated owned ledger transactions.", auth: true },
  { method: "get", path: "/wallet/transactions/{id}", tag: "Wallet", summary: "Get wallet transaction", description: "Returns one transaction only when it belongs to the user.", auth: true },
  { method: "post", path: "/wallet/topups", tag: "Wallet", summary: "Initialize Paystack top-up", description: "Creates a pending ledger record and initializes Paystack. It never credits from the client callback.", auth: true, idempotency: true, requestBody: true },
  { method: "get", path: "/wallet/topups/{reference}/verify", tag: "Wallet", summary: "Verify Paystack top-up", description: "Verifies provider status and amount before one-time atomic wallet credit.", auth: true },
  { method: "get", path: "/wallet/banks", tag: "Wallet", summary: "List Paystack banks", description: "Returns and caches active Nigerian banks from Paystack.", auth: true },
  { method: "get", path: "/wallet/bank-accounts", tag: "Wallet", summary: "List saved bank accounts", description: "Returns masked saved accounts only.", auth: true },
  { method: "post", path: "/wallet/bank-accounts", tag: "Wallet", summary: "Save bank account", description: "Resolves account ownership, creates a Paystack recipient, encrypts the account number, and returns only masked digits.", auth: true, requestBody: true },
  { method: "delete", path: "/wallet/bank-accounts/{id}", tag: "Wallet", summary: "Remove bank account", description: "Deactivates an owned bank account.", auth: true },
  { method: "post", path: "/wallet/transfers", tag: "Wallet", summary: "Transfer between wallets", description: "Uses Redis locking, idempotency, balance guard, and a Mongo transaction for paired ledger entries.", auth: true, idempotency: true, requestBody: true },
  { method: "post", path: "/wallet/withdrawals", tag: "Wallet", summary: "Withdraw through Paystack", description: "Reserves funds atomically, uses an owned recipient, and initiates a referenced Paystack transfer.", auth: true, idempotency: true, requestBody: true },
  { method: "post", path: "/wallet/withdrawals/{reference}/finalize", tag: "Wallet", summary: "Finalize withdrawal OTP", description: "Finalizes a user-owned transfer only when Paystack requires OTP.", auth: true, requestBody: true },

  { method: "post", path: "/uploads/images", tag: "Uploads", summary: "Upload image", description: "Uploads one authenticated JPEG, PNG, or WebP image through memory storage to Cloudinary.", auth: true, requestBody: true },
  { method: "post", path: "/webhooks/paystack", tag: "Webhooks", summary: "Receive Paystack webhook", description: "Verifies HMAC-SHA512 over the raw body, deduplicates events, and applies idempotent wallet transitions.", auth: false },
];
