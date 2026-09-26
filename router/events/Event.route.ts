import { Router } from "express";
import { z } from "zod";
import {
  addTicketType,
  cancelEvent,
  checkInTicket,
  createEvent,
  deleteDraftEvent,
  getEvent,
  getRecommendedEvents,
  listAttendees,
  listCreatedEvents,
  listEvents,
  publishEvent,
  removeTicketType,
  updateEvent,
  updateTicketType,
  verifyCheckInTicket,
} from "../../Controller/event.controller";
import { createTargetReport } from "../../Controller/report.controller";
import { createTicketOrder } from "../../Controller/ticket.controller";
import { authenticate, optionalAuthenticate } from "../../middleware/auth.middleware";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema, paginationSchema } from "../../schemas/common.schemas";
import { reportBodySchema } from "../../schemas/report.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const eventBodyBase = z.object({
  title: z.string().trim().min(4).max(140),
  description: z.string().trim().min(20).max(5000),
  coverImageUrl: z.string().url().optional(),
  activityType: z.string().trim().min(2).max(60),
  targetAudience: z.string().trim().max(60).optional(),
  setting: z.enum(["indoor", "outdoor", "online", "hybrid"]),
  country: z.string().trim().min(2).max(80).default("Nigeria"),
  state: z.string().trim().min(2).max(80),
  lga: z.string().trim().min(2).max(100),
  venueName: z.string().trim().min(2).max(180),
  address: z.string().trim().min(5).max(300),
  coordinates: z.object({
    type: z.literal("Point").default("Point"),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default("Africa/Lagos"),
  contactPhone: z.string().trim().min(7).max(24).optional(),
  maxCapacity: z.number().int().min(1).max(1_000_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
}).strict();
const eventBody = eventBodyBase.refine((value) => value.endsAt > value.startsAt, {
  message: "End date must be after start date",
  path: ["endsAt"],
});
const eventUpdateBody = eventBodyBase
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one event field is required",
  })
  .refine(
    (value) => (
      value.startsAt === undefined
      || value.endsAt === undefined
      || value.endsAt > value.startsAt
    ),
    {
      message: "End date must be after start date",
      path: ["endsAt"],
    },
  );
const ticketBody = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  priceKobo: z.number().int().min(0).max(100_000_000_00),
  capacity: z.number().int().min(1).max(1_000_000).optional(),
}).strict();
const eventTicketParams = z.object({ id: objectIdSchema, ticketTypeId: objectIdSchema });
// Coordinates are optional, but accepting only complete pairs prevents an
// ambiguous distance calculation and accidental zero-value defaults.
const locationQueryFields = {
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(500).default(100),
};

router.get(
  "/",
  optionalAuthenticate,
  validate({
    query: paginationSchema.extend({
      state: z.string().max(80).optional(),
      lga: z.string().max(100).optional(),
      activityType: z.string().max(60).optional(),
      latitude: z.coerce.number().min(-90).max(90).optional(),
      longitude: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().positive().max(500).default(100),
    }).refine(
      (value) => (value.latitude === undefined) === (value.longitude === undefined),
      { message: "Latitude and longitude must be supplied together" },
    ),
  }),
  asyncHandler(listEvents),
);
router.get(
  "/recommended",
  authenticate,
  validate({
    query: z.object({
      ...locationQueryFields,
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).refine(
      (value) => (value.latitude === undefined) === (value.longitude === undefined),
      { message: "Latitude and longitude must be supplied together" },
    ),
  }),
  asyncHandler(getRecommendedEvents),
);
router.get("/created/me", authenticate, asyncHandler(listCreatedEvents));
router.get("/:id", optionalAuthenticate, validate({ params: idParamsSchema }), asyncHandler(getEvent));
router.post("/", authenticate, validate({ body: eventBody }), asyncHandler(createEvent));
router.patch(
  "/:id",
  authenticate,
  validate({ params: idParamsSchema, body: eventUpdateBody }),
  asyncHandler(updateEvent),
);
router.post(
  "/:id/orders",
  authenticate,
  requireIdempotencyKey,
  validate({
    params: idParamsSchema,
    body: z.object({
      ticketTypeId: objectIdSchema,
      quantity: z.number().int().min(1).max(20),
    }).strict(),
  }),
  asyncHandler(createTicketOrder),
);
router.post("/:id/publish", authenticate, validate({ params: idParamsSchema }), asyncHandler(publishEvent));
router.post("/:id/cancel", authenticate, validate({ params: idParamsSchema }), asyncHandler(cancelEvent));
router.delete("/:id", authenticate, validate({ params: idParamsSchema }), asyncHandler(deleteDraftEvent));
router.post(
  "/:id/ticket-types",
  authenticate,
  validate({ params: idParamsSchema, body: ticketBody }),
  asyncHandler(addTicketType),
);
router.patch(
  "/:id/ticket-types/:ticketTypeId",
  authenticate,
  validate({ params: eventTicketParams, body: ticketBody.partial().refine((v) => Object.keys(v).length > 0) }),
  asyncHandler(updateTicketType),
);
router.delete(
  "/:id/ticket-types/:ticketTypeId",
  authenticate,
  validate({ params: eventTicketParams }),
  asyncHandler(removeTicketType),
);
router.post(
  "/:id/reports",
  authenticate,
  validate({ params: idParamsSchema, body: reportBodySchema }),
  asyncHandler(createTargetReport("event")),
);
router.get("/:id/attendees", authenticate, validate({ params: idParamsSchema }), asyncHandler(listAttendees));
const checkInBody = z.object({ qrToken: z.string().min(32).max(4096) }).strict();
router.post(
  "/:eventId/check-ins/verify",
  authenticate,
  validate({ params: z.object({ eventId: objectIdSchema }), body: checkInBody }),
  asyncHandler(verifyCheckInTicket),
);
router.post(
  "/:id/check-ins",
  authenticate,
  validate({ params: idParamsSchema, body: checkInBody }),
  asyncHandler(checkInTicket),
);

export default router;
