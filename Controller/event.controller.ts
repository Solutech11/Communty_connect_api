import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getPersonalizedEventRecommendations } from "../Community_AI/EventRecommendation.algorithm";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { AppError } from "../utils/AppError";
import { sha256 } from "../utils/crypto.utils";
import { sendSuccess } from "../utils/response.utils";

const createSlug = (title: string): string => {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return `${base}-${randomBytes(4).toString("hex")}`;
};

export const listEvents = async (request: Request, response: Response): Promise<Response> => {
  const { search, state, lga, activityType } = request.query as Record<string, string>;
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const radiusKm = Number(request.query.radiusKm || 100);
  const query: Record<string, unknown> = { status: "published", startsAt: { $gte: new Date() } };

  if (state) {
    query.state = state;
  }
  if (lga) {
    query.lga = lga;
  }
  if (activityType) {
    query.activityType = activityType;
  }

  const requestedLatitude = request.query.latitude === undefined
    ? undefined
    : Number(request.query.latitude);
  const requestedLongitude = request.query.longitude === undefined
    ? undefined
    : Number(request.query.longitude);
  // GeoJSON order is longitude first. Request coordinates take precedence over
  // the authenticated user's saved profile location.
  let userCoordinates = requestedLatitude !== undefined && requestedLongitude !== undefined
    ? [requestedLongitude, requestedLatitude] as [number, number]
    : undefined;

  if (!userCoordinates && request.auth?.id) {
    const user = await UserModel.findById(request.auth.id).select("location").lean();
    if (user?.location?.coordinates?.length === 2) {
      userCoordinates = [
        user.location.coordinates[0] as number,
        user.location.coordinates[1] as number,
      ];
    }
  }

  if (userCoordinates) {
    if (search) {
      // Escape regex metacharacters so search text is treated as data, not a pattern.
      const escapedSearch = search.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escapedSearch, "i");
      query.$or = [{ title: pattern }, { description: pattern }, { tags: pattern }];
    }

    // $geoNear must remain the first aggregation stage to use the 2dsphere index.
    const [result] = await EventModel.aggregate<{
      events: Array<Record<string, unknown> & { distanceMeters: number }>;
      total: Array<{ count: number }>;
    }>([
      {
        $geoNear: {
          near: { type: "Point", coordinates: userCoordinates },
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          spherical: true,
          query,
        },
      },
      {
        $facet: {
          events: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          total: [{ $count: "count" }],
        },
      },
    ]);
    const nearbyEvents = (result?.events || []).map((event) => ({
      ...event,
      distanceKm: Number((event.distanceMeters / 1000).toFixed(2)),
    }));
    const events = await EventModel.populate(nearbyEvents, {
      path: "creatorId",
      select: "firstName lastName avatarUrl",
    });

    return sendSuccess(response, 200, "Nearby events retrieved", {
      events,
      sort: "nearest",
      locationUsed: { latitude: userCoordinates[1], longitude: userCoordinates[0] },
      pagination: { page, limit, total: result?.total[0]?.count || 0 },
    });
  }

  if (search) {
    // Without coordinates, the normal text index is faster than a regex scan.
    query.$text = { $search: search };
  }

  const [events, total] = await Promise.all([
    EventModel.find(query)
      .populate("creatorId", "firstName lastName avatarUrl")
      .sort({ startsAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    EventModel.countDocuments(query),
  ]);

  return sendSuccess(response, 200, "Events retrieved", {
    events,
    sort: "soonest",
    pagination: { page, limit, total },
  });
};

export const getRecommendedEvents = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const recommendations = await getPersonalizedEventRecommendations({
    userId: request.auth?.id as string,
    latitude: request.query.latitude === undefined ? undefined : Number(request.query.latitude),
    longitude: request.query.longitude === undefined ? undefined : Number(request.query.longitude),
    radiusKm: Number(request.query.radiusKm || 100),
    limit: Number(request.query.limit || 20),
  });

  return sendSuccess(response, 200, "Personalized nearby events retrieved", recommendations);
};

export const getEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await EventModel.findById((request.params.id as string)).populate(
    "creatorId",
    "firstName lastName avatarUrl bio",
  );

  if (!event || (event.status === "draft" && event.creatorId._id.toString() !== request.auth?.id)) {
    throw new AppError(404, "Event was not found", "EVENT_NOT_FOUND");
  }

  const ticketTypes = await TicketTypeModel.find({ eventId: event._id, active: true });
  return sendSuccess(response, 200, "Event retrieved", { event, ticketTypes });
};

export const createEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await EventModel.create({
    ...request.body,
    creatorId: request.auth?.id,
    slug: createSlug(request.body.title),
    status: "draft",
  });

  return sendSuccess(response, 201, "Event draft created", { event });
};

const requireOwnedEvent = async (eventId: string, userId: string) => {
  const event = await EventModel.findOne({ _id: eventId, creatorId: userId });

  if (!event) {
    throw new AppError(404, "Event was not found", "EVENT_NOT_FOUND");
  }

  return event;
};

export const updateEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);

  if (event.status !== "draft") {
    throw new AppError(409, "Only draft events can be fully edited", "EVENT_NOT_EDITABLE");
  }

  event.set(request.body);
  await event.save();
  return sendSuccess(response, 200, "Event updated", { event });
};

export const publishEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const ticketCount = await TicketTypeModel.countDocuments({ eventId: event._id, active: true });

  if (ticketCount === 0) {
    throw new AppError(422, "Add at least one ticket type before publishing", "TICKET_TYPE_REQUIRED");
  }

  if (event.startsAt.getTime() <= Date.now() || event.endsAt <= event.startsAt) {
    throw new AppError(422, "Event dates are invalid for publishing", "INVALID_EVENT_DATES");
  }

  event.status = "published";
  event.publishedAt = new Date();
  await event.save();
  return sendSuccess(response, 200, "Event published", { event });
};

export const cancelEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  event.status = "cancelled";
  event.cancelledAt = new Date();
  await event.save();
  return sendSuccess(response, 200, "Event cancelled", { event });
};

export const deleteDraftEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);

  if (event.status !== "draft") {
    throw new AppError(409, "Only draft events can be deleted", "EVENT_NOT_DELETABLE");
  }

  await Promise.all([
    TicketTypeModel.deleteMany({ eventId: event._id }),
    event.deleteOne(),
  ]);
  return sendSuccess(response, 200, "Event draft deleted");
};

export const addTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);

  if (event.status !== "draft") {
    throw new AppError(409, "Ticket types can only be added to drafts", "EVENT_NOT_EDITABLE");
  }

  const currentCount = await TicketTypeModel.countDocuments({ eventId: event._id, active: true });

  if (currentCount >= 10) {
    throw new AppError(422, "A maximum of 10 ticket types is allowed", "TICKET_LIMIT_REACHED");
  }

  const ticketType = await TicketTypeModel.create({ ...request.body, eventId: event._id });
  return sendSuccess(response, 201, "Ticket type created", { ticketType });
};

export const updateTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const ticketType = await TicketTypeModel.findOne({
    _id: (request.params.ticketTypeId as string),
    eventId: event._id,
  });

  if (!ticketType || ticketType.sold > 0) {
    throw new AppError(409, "This ticket type cannot be edited", "TICKET_NOT_EDITABLE");
  }

  ticketType.set(request.body);
  await ticketType.save();
  return sendSuccess(response, 200, "Ticket type updated", { ticketType });
};

export const removeTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const result = await TicketTypeModel.updateOne(
    { _id: (request.params.ticketTypeId as string), eventId: event._id, sold: 0 },
    { active: false },
  );

  if (result.modifiedCount === 0) {
    throw new AppError(409, "This ticket type cannot be removed", "TICKET_NOT_REMOVABLE");
  }

  return sendSuccess(response, 200, "Ticket type removed");
};

export const listCreatedEvents = async (request: Request, response: Response): Promise<Response> => {
  const events = await EventModel.find({ creatorId: request.auth?.id }).sort({ createdAt: -1 });
  return sendSuccess(response, 200, "Created events retrieved", { events });
};

export const listAttendees = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const orders = await TicketOrderModel.find({ eventId: event._id, status: "paid" })
    .populate("buyerId", "firstName lastName email avatarUrl")
    .populate("ticketTypeId", "title");
  return sendSuccess(response, 200, "Attendees retrieved", { attendees: orders });
};

export const checkInTicket = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const qrTokenHash = sha256(request.body.qrToken);
  const order = await TicketOrderModel.findOne({
    eventId: event._id,
    qrTokenHash,
    status: "paid",
  }).select("+qrTokenHash");

  if (!order) {
    throw new AppError(404, "Ticket is invalid", "INVALID_TICKET");
  }

  if (order.checkedInAt) {
    throw new AppError(409, "Ticket has already been checked in", "TICKET_ALREADY_USED", {
      checkedInAt: order.checkedInAt,
    });
  }

  order.checkedInAt = new Date();
  order.checkedInBy = request.auth?.id as never;
  await order.save();
  return sendSuccess(response, 200, "Ticket checked in", { order });
};

