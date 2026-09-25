const redactedValue = "[REDACTED]";
const paystackEventTypes = new Set([
  "charge.success",
  "charge.failed",
  "transfer.success",
  "transfer.failed",
  "transfer.reversed",
  "refund.processed",
  "refund.failed",
]);
const safePaystackDataFieldNames = new Set(["id", "reference", "amount", "status", "transfer_code"]);

const sensitiveFieldPattern = /password|passwd|pwd|secret|token|otp|authorization|cookie|account|email|phone|message|text|content|description|details|bio|name|address|location|coordinate|latitude|longitude|amount|price|payment|recipient|qr|image|cover|avatar|note|reason/i;

const safeStringValuesByField: Record<string, ReadonlySet<string>> = {
  action: new Set(["accept", "decline", "reject"]),
  direction: new Set(["credit", "debit"]),
  folder: new Set(["avatars", "events", "communities", "disputes", "chat", "uploads", "community-chat"]),
  joinpolicy: new Set(["open", "approval", "invite_only", "access_code"]),
  level: new Set(["all", "announcements", "mentions", "muted"]),
  membershiptype: new Set(["free", "premium"]),
  messagepermission: new Set(["everyone", "moderators"]),
  participationrole: new Set(["participant", "organizer"]),
  preferredgroupsize: new Set(["small", "medium", "large"]),
  preferredsetting: new Set(["indoor", "outdoor"]),
  role: new Set(["owner", "moderator", "member"]),
  setting: new Set(["indoor", "outdoor", "online", "hybrid"]),
  status: new Set([
    "pending_verification", "active", "suspended", "deleted", "pending", "paid", "cancelled",
    "refunded", "processing", "successful", "failed", "reversed", "open", "under_review",
    "awaiting_user", "resolved", "closed", "draft", "pending_approval", "published", "rejected",
    "deactivated", "completed", "accepted", "declined", "blocked", "removed", "banned", "approved",
    "ended",
  ]),
  type: new Set([
    "direct", "group", "support", "text", "image", "voice", "video", "system", "pdf", "file",
    "topup", "internal_transfer", "withdrawal", "ticket_purchase", "community_purchase", "refund",
    "adjustment",
  ]),
  visibility: new Set(["public", "private"]),
};

const safeNumberFields = new Set(["page", "limit", "quantity", "maxuses", "capacity", "maxcapacity"]);
const safeBooleanFields = new Set(["memberscancreateposts", "memberscaninvite", "showmemberlist", "pinned"]);

const normalizeFieldName = (field: string): string => field.replace(/[^a-z\d]/gi, "").toLowerCase();

const getWebhookDiagnostics = (body: unknown, rawBodyByteLength?: number): unknown => {
  const payload = body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const data = payload.data !== null && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  const dataFields = Object.keys(data).filter((field) => safePaystackDataFieldNames.has(field));

  return {
    eventType: typeof payload.event === "string" && paystackEventTypes.has(payload.event)
      ? payload.event
      : redactedValue,
    dataFields,
    dataFieldCount: Object.keys(data).length,
    payloadByteLength: Number.isSafeInteger(rawBodyByteLength) && (rawBodyByteLength as number) >= 0
      ? rawBodyByteLength
      : null,
  };
};

const isSensitiveField = (normalizedField: string): boolean =>
  sensitiveFieldPattern.test(normalizedField)
  || /reference(?:id|code|number)?$/.test(normalizedField);

const sanitizeValue = (value: unknown, field: string, depth: number): unknown => {
  const normalizedField = normalizeFieldName(field);
  const safeValues = safeStringValuesByField[normalizedField];
  if (typeof value === "string" && safeValues?.has(value)) {
    return value;
  }

  if (isSensitiveField(normalizedField)) {
    return redactedValue;
  }

  if (Array.isArray(value)) {
    return { itemCount: value.length };
  }

  if (Buffer.isBuffer(value)) {
    return redactedValue;
  }

  if (value !== null && typeof value === "object") {
    if (depth >= 8) {
      return redactedValue;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const sanitizedEntries = entries.slice(0, 50).map(([key, child]) => [
      key,
      sanitizeValue(child, key, depth + 1),
    ] as const);
    const sanitizedObject = Object.fromEntries(sanitizedEntries);

    if (entries.length > sanitizedEntries.length) {
      sanitizedObject._omittedFieldCount = entries.length - sanitizedEntries.length;
    }

    return sanitizedObject;
  }

  if (typeof value === "string") {
    if (normalizedField === "countrycode" && /^[a-z]{2}$/i.test(value)) {
      return value.slice(0, 2).toUpperCase();
    }

    return safeValues?.has(value) ? value : redactedValue;
  }

  if (typeof value === "number") {
    return safeNumberFields.has(normalizedField) && Number.isFinite(value) && Math.abs(value) <= 10_000
      ? value
      : redactedValue;
  }

  if (typeof value === "boolean") {
    return safeBooleanFields.has(normalizedField) ? value : redactedValue;
  }

  return value === null ? null : redactedValue;
};

/**
 * Preserve only non-sensitive request metadata for logs. Free text, personal
 * data, identifiers, money, locations, unknown fields, and webhook values are
 * hidden; arrays are reduced to counts so their contents never leak.
 */
export const sanitizeRequestBodyForLog = (
  body: unknown,
  requestPath = "",
  rawBodyByteLength?: number,
): unknown => {
  if (/\/webhooks?(?:\/|$)/i.test(requestPath.split("?")[0] || "")) {
    return getWebhookDiagnostics(body, rawBodyByteLength);
  }

  if (body === undefined) {
    return null;
  }

  if (body !== null && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) {
    return sanitizeValue(body, "", 0);
  }

  return sanitizeValue(body, "", 0);
};

export const requestBodyLogFields = (
  enabled: boolean,
  body: unknown,
  requestPath: string,
  rawBodyByteLength?: number,
): Record<string, unknown> => enabled
  ? { requestBody: sanitizeRequestBodyForLog(body, requestPath, rawBodyByteLength) }
  : {};
