import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getPersonalizedEventRecommendations } from "../Community_AI/EventRecommendation.algorithm";
import {
  isModeratableEventImageUrl,
  markUnreviewableEventImage,
  moderateEventWithGroq,
} from "../Community_AI/Groq";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { AppError } from "../utils/AppError";
import { sha256 } from "../utils/crypto.utils";
import { eventModerationEmailTemplate, sendEmail } from "../utils/mailer.utils";
import { logger } from "../utils/logger.utils";
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

  // console.log("Event retrieved:", event);
  const isOwner = event?.creatorId._id.toString() === request.auth?.id;

  console.log("Is owner:", isOwner, "Event creator ID:", event?.creatorId._id.toString(), "Request auth ID:", request.auth?.id);
  const isAdmin = request.auth?.role === "admin";

  if (!event || (event.status !== "published" && !isOwner && !isAdmin)) {
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

type OwnedEvent = Awaited<ReturnType<typeof requireOwnedEvent>>;

const isEventEditable = (event: OwnedEvent): boolean => {
  return event.status === "draft" || event.status === "rejected";
};

// A declined event must return to a clean draft before an organizer corrects
// it. Its old reasons cannot be mistaken for a review of newly edited content.
const resetRejectedEventForEditing = (event: OwnedEvent): void => {
  if (event.status !== "rejected") {
    return;
  }

  event.status = "draft";
  event.set("submittedAt", undefined);
  event.set("moderation", undefined);
  event.set("approvedAt", undefined);
  event.set("publishedAt", undefined);
};

export const updateEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);

  if (!isEventEditable(event)) {
    throw new AppError(409, "Only draft or declined events can be edited", "EVENT_NOT_EDITABLE");
  }

  event.set(request.body);

  if (event.endsAt <= event.startsAt) {
    throw new AppError(422, "End date must be after start date", "INVALID_EVENT_DATES");
  }

  resetRejectedEventForEditing(event);
  await event.save();
  return sendSuccess(response, 200, "Event updated", { event });
};

export const publishEvent = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const ticketTypes = await TicketTypeModel.find({ eventId: event._id, active: true }).lean();

  if (ticketTypes.length === 0) {
    throw new AppError(422, "Add at least one ticket type before publishing", "TICKET_TYPE_REQUIRED");
  }

  if (event.startsAt.getTime() <= Date.now() || event.endsAt <= event.startsAt) {
    throw new AppError(422, "Event dates are invalid for publishing", "INVALID_EVENT_DATES");
  }

  const retryingPendingReview =
    event.status === "pending_approval" && !event.moderation;
  if (
    event.status !== "draft" &&
    event.status !== "rejected" &&
    !retryingPendingReview
  ) {
    throw new AppError(
      409,
      "Only a draft, declined event, or event awaiting automatic review can be submitted",
      "EVENT_NOT_SUBMITTABLE",
    );
  }

  // Claim the review before calling Groq so duplicate taps cannot cause
  // concurrent provider calls or competing publish decisions. A pending event
  // is retryable only when its automatic review previously failed unavailable.
  const submittedAt = new Date();
  const moderationLeaseUntil = new Date(submittedAt.getTime() + 5 * 60_000);
  const claimUpdate = {
    $set: {
      status: "pending_approval" as const,
      submittedAt,
      moderationInProgressUntil: moderationLeaseUntil,
    },
    $unset: { moderation: 1, approvedAt: 1, approvedBy: 1, publishedAt: 1 },
  };
  const pendingEvent = retryingPendingReview
    ? await EventModel.findOneAndUpdate(
        {
          _id: event._id,
          creatorId: request.auth?.id,
          status: "pending_approval",
          moderation: { $exists: false },
          $or: [
            { moderationInProgressUntil: { $exists: false } },
            { moderationInProgressUntil: { $lte: submittedAt } },
          ],
        },
        claimUpdate,
        { new: true, runValidators: true, includeResultMetadata: false },
      )
    : await EventModel.findOneAndUpdate(
        {
          _id: event._id,
          creatorId: request.auth?.id,
          status: { $in: ["draft", "rejected"] },
        },
        claimUpdate,
        { new: true, runValidators: true, includeResultMetadata: false },
      );

  if (!pendingEvent) {
    throw new AppError(409, "Event is already being reviewed or is no longer submittable", "EVENT_NOT_SUBMITTABLE");
  }

  const releaseModerationClaim = () =>
    EventModel.findOneAndUpdate(
      {
        _id: pendingEvent._id,
        status: "pending_approval",
        moderationInProgressUntil: moderationLeaseUntil,
      },
      { $unset: { moderationInProgressUntil: 1 } },
      { new: true, includeResultMetadata: false },
    );

  const imageReviewStatus = !pendingEvent.coverImageUrl
    ? "not_provided"
    : isModeratableEventImageUrl(pendingEvent.coverImageUrl)
      ? "included"
      : "unreviewable";

  try {
    let moderation = await moderateEventWithGroq({
      title: pendingEvent.title,
      description: pendingEvent.description,
      activityType: pendingEvent.activityType,
      targetAudience: pendingEvent.targetAudience ?? undefined,
      setting: pendingEvent.setting,
      country: pendingEvent.country,
      state: pendingEvent.state,
      lga: pendingEvent.lga,
      venueName: pendingEvent.venueName,
      address: pendingEvent.address,
      startsAt: pendingEvent.startsAt.toISOString(),
      endsAt: pendingEvent.endsAt.toISOString(),
      maxCapacity: pendingEvent.maxCapacity,
      tags: pendingEvent.tags,
      coverImageUrl: imageReviewStatus === "included"
        ? pendingEvent.coverImageUrl ?? undefined
        : undefined,
      imageReviewStatus,
      ticketTypes: ticketTypes.map((ticketType) => ({
        title: ticketType.title,
        description: ticketType.description ?? undefined,
        priceKobo: ticketType.priceKobo,
        capacity: ticketType.capacity ?? undefined,
      })),
    });

    if (imageReviewStatus === "unreviewable") {
      moderation = markUnreviewableEventImage(moderation);
    }

    const reviewedAt = new Date();
    const approved = moderation.verdict === "approved";
    const reviewedEvent = await EventModel.findOneAndUpdate(
      {
        _id: pendingEvent._id,
        status: "pending_approval",
        moderationInProgressUntil: moderationLeaseUntil,
      },
      {
        $set: {
          status: approved ? "published" : "rejected",
          moderation: {
            provider: "groq",
            model: moderation.model,
            verdict: moderation.verdict,
            reviewedAt,
            reasons: moderation.reasons,
            checks: moderation.checks,
          },
          ...(approved ? { approvedAt: reviewedAt, publishedAt: reviewedAt } : {}),
        },
        $unset: approved
          ? { approvedBy: 1, moderationInProgressUntil: 1 }
          : {
              approvedAt: 1,
              approvedBy: 1,
              publishedAt: 1,
              moderationInProgressUntil: 1,
            },
      },
      { new: true, runValidators: true, includeResultMetadata: false },
    );

    if (!reviewedEvent) {
      const currentEvent = await EventModel.findById(pendingEvent._id);
      return sendSuccess(response, 200, "Event status changed while automatic review was running", {
        event: currentEvent,
      });
    }

    const organizer = await UserModel.findById(request.auth?.id).select("firstName email").lean();
    if (organizer) {
      try {
        await sendEmail({
          toEmail: organizer.email,
          toName: organizer.firstName,
          subject: approved ? "Your event is published" : "Action needed: update your event",
          html: eventModerationEmailTemplate({
            name: organizer.firstName,
            eventTitle: reviewedEvent.title,
            verdict: moderation.verdict,
            reasons: moderation.reasons,
          }),
        });
      } catch {
        // A mail outage must not reverse a completed moderation decision.
        logger.warn(
          { operation: "event_moderation_email", eventId: reviewedEvent._id.toString() },
          "Event moderation email could not be sent",
        );
      }
    }

    return sendSuccess(
      response,
      200,
      approved ? "Event approved and published" : "Event declined after automatic review",
      { event: reviewedEvent },
    );
  } catch (error) {
    let releasedEvent = null;
    try {
      releasedEvent = await releaseModerationClaim();
    } catch (releaseError) {
      logger.warn(
        {
          operation: "event_moderation_claim_release",
          eventId: pendingEvent._id.toString(),
          error: releaseError,
        },
        "Event moderation retry lock could not be released",
      );
    }

    if (error instanceof AppError && error.code === "GROQ_MODERATION_UNAVAILABLE") {
      // Fail closed: provider trouble can never turn a submission into a live event.
      return sendSuccess(
        response,
        202,
        "Event submitted for manual review because automatic review is unavailable",
        { event: releasedEvent ?? pendingEvent },
      );
    }

    throw error;
  }
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

  if (!isEventEditable(event)) {
    throw new AppError(409, "Only draft or declined events can be deleted", "EVENT_NOT_DELETABLE");
  }

  await Promise.all([
    TicketTypeModel.deleteMany({ eventId: event._id }),
    event.deleteOne(),
  ]);
  return sendSuccess(response, 200, "Event deleted");
};

export const addTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const wasRejected = event.status === "rejected";

  if (!isEventEditable(event)) {
    throw new AppError(409, "Ticket types can only be changed on draft or declined events", "EVENT_NOT_EDITABLE");
  }

  const currentCount = await TicketTypeModel.countDocuments({ eventId: event._id, active: true });

  if (currentCount >= 10) {
    throw new AppError(422, "A maximum of 10 ticket types is allowed", "TICKET_LIMIT_REACHED");
  }

  const ticketType = await TicketTypeModel.create({ ...request.body, eventId: event._id });
  if (wasRejected) {
    resetRejectedEventForEditing(event);
    await event.save();
  }
  return sendSuccess(response, 201, "Ticket type created", { ticketType });
};

export const updateTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const wasRejected = event.status === "rejected";

  if (!isEventEditable(event)) {
    throw new AppError(409, "Ticket types can only be changed on draft or declined events", "EVENT_NOT_EDITABLE");
  }

  const ticketType = await TicketTypeModel.findOne({
    _id: (request.params.ticketTypeId as string),
    eventId: event._id,
  });

  if (!ticketType || ticketType.sold > 0) {
    throw new AppError(409, "This ticket type cannot be edited", "TICKET_NOT_EDITABLE");
  }

  ticketType.set(request.body);
  if (wasRejected) {
    resetRejectedEventForEditing(event);
    await Promise.all([ticketType.save(), event.save()]);
  } else {
    await ticketType.save();
  }
  return sendSuccess(response, 200, "Ticket type updated", { ticketType });
};

export const removeTicketType = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent((request.params.id as string), request.auth?.id as string);
  const wasRejected = event.status === "rejected";

  if (!isEventEditable(event)) {
    throw new AppError(409, "Ticket types can only be changed on draft or declined events", "EVENT_NOT_EDITABLE");
  }

  const result = await TicketTypeModel.updateOne(
    { _id: (request.params.ticketTypeId as string), eventId: event._id, sold: 0 },
    { active: false },
  );

  if (result.modifiedCount === 0) {
    throw new AppError(409, "This ticket type cannot be removed", "TICKET_NOT_REMOVABLE");
  }

  if (wasRejected) {
    resetRejectedEventForEditing(event);
    await event.save();
  }

  return sendSuccess(response, 200, "Ticket type removed");
};

export const listCreatedEvents = async (request: Request, response: Response): Promise<Response> => {
  const events = await EventModel.find({ creatorId: request.auth?.id }).sort({ createdAt: -1 });
  return sendSuccess(response, 200, "Created events retrieved", { events });
};

export const listAttendees = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent(request.params.id as string, request.auth?.id as string);
  const orders = await TicketOrderModel.find({ eventId: event._id, status: "paid" })
    .populate("buyerId", "firstName lastName email avatarUrl")
    .populate("ticketTypeId", "title")
    .sort({ createdAt: -1 });
  const attendees = orders.map((order) => ({
    ...order.toObject(),
    checkedIn: Boolean(order.checkedInAt),
    checkedInAt: order.checkedInAt || null,
  }));
  const totalTickets = orders.reduce((sum, order) => sum + order.quantity, 0);
  const checkedInTickets = orders.reduce(
    (sum, order) => sum + (order.checkedInAt ? order.quantity : 0),
    0,
  );

  return sendSuccess(response, 200, "Attendees retrieved", {
    attendees,
    summary: {
      orders: orders.length,
      totalTickets,
      checkedInTickets,
      pendingTickets: totalTickets - checkedInTickets,
    },
  });
};
export const checkInTicket = async (request: Request, response: Response): Promise<Response> => {
  const event = await requireOwnedEvent(request.params.id as string, request.auth?.id as string);
  const qrTokenHash = sha256(request.body.qrToken);
  const checkedInAt = new Date();
  const order = await TicketOrderModel.findOneAndUpdate(
    {
      eventId: event._id,
      qrTokenHash,
      status: "paid",
      checkedInAt: { $exists: false },
    },
    {
      $set: {
        checkedInAt,
        checkedInBy: request.auth?.id,
      },
    },
    { new: true },
  ).select("+qrTokenHash");

  if (order) {
    order.set("qrTokenHash", undefined);
    return sendSuccess(response, 200, "Ticket checked in", { order });
  }

  const usedOrder = await TicketOrderModel.findOne({
    eventId: event._id,
    qrTokenHash,
    status: "paid",
  })
    .select("+qrTokenHash checkedInAt")
    .lean();

  if (usedOrder?.checkedInAt) {
    throw new AppError(409, "Ticket has already been checked in", "TICKET_ALREADY_USED", {
      checkedInAt: usedOrder.checkedInAt,
    });
  }

  throw new AppError(404, "Ticket is invalid", "INVALID_TICKET");
};
