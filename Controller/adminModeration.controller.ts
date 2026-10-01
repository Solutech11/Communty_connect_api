import type { Request, Response } from "express";
import type { Namespace } from "socket.io";
import mongoose from "mongoose";
import { z } from "zod";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";
import { CommunityMembershipOrderModel } from "../models/Community/CommunityMembershipOrder.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { ReportModel } from "../models/Report/Report.model";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger.utils";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const parseId = (value: unknown, label: string): string => {
  const result = objectIdSchema.safeParse(value);
  if (!result.success) throw new AppError(400, `${label} identifier is invalid`, "INVALID_IDENTIFIER");
  return result.data;
};

const parsePage = (value: unknown): number => {
  const page = typeof value === "string" ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
};

const redirectWithMessage = (response: Response, path: string, message: string): void => {
  response.redirect(`${path}?message=${encodeURIComponent(message)}`);
};

const adminId = (request: Request) => request.admin?.userId as never;
const formatNaira = (kobo: number) => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
}).format(kobo / 100);

export const renderAdminEvents = async (request: Request, response: Response): Promise<void> => {
  const page = parsePage(request.query.page);
  const statuses = ["all", "pending_approval", "published", "deactivated", "rejected", "cancelled", "completed", "draft"] as const;
  const requestedStatus = typeof request.query.status === "string" ? request.query.status : "pending_approval";
  const status = statuses.includes(requestedStatus as typeof statuses[number])
    ? requestedStatus as typeof statuses[number]
    : "pending_approval";
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 80) : "";
  const query: Record<string, unknown> = status === "all" ? {} : { status };
  if (search) query.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const [events, total, statusCounts] = await Promise.all([
    EventModel.find(query).populate("creatorId", "firstName lastName email status")
      .sort({ submittedAt: -1, createdAt: -1 }).skip((page - 1) * 30).limit(30).lean(),
    EventModel.countDocuments(query),
    EventModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const eventIds = events.map((event) => event._id);
  const orderStats = await TicketOrderModel.aggregate<{
    _id: mongoose.Types.ObjectId;
    tickets: number;
    orders: number;
    grossKobo: number;
  }>([
    { $match: { eventId: { $in: eventIds }, status: "paid" } },
    { $group: { _id: "$eventId", tickets: { $sum: "$quantity" }, orders: { $sum: 1 }, grossKobo: { $sum: "$totalKobo" } } },
  ]);
  const salesByEvent = new Map(orderStats.map((item) => [String(item._id), item]));

  response.setHeader("Cache-Control", "no-store");
  response.render("admin/events", {
    title: "Events · Community Connect Admin",
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "events",
    events,
    salesByEvent,
    page,
    total,
    pageCount: Math.max(1, Math.ceil(total / 30)),
    status,
    counts: Object.fromEntries(statusCounts.map((item) => [item._id, item.count])),
    search,
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
    formatNaira,
  });
};

export const renderAdminEventDetails = async (request: Request, response: Response): Promise<void> => {
  const eventId = parseId(request.params.id, "Event");
  const page = parsePage(request.query.page);
  const statusValues = ["paid", "pending", "refunded", "cancelled", "all"] as const;
  const statusQuery = typeof request.query.status === "string" ? request.query.status : "paid";
  const status = statusValues.includes(statusQuery as typeof statusValues[number])
    ? statusQuery as typeof statusValues[number]
    : "paid";
  const orderFilter = status === "all" ? { eventId } : { eventId, status };

  const [event, ticketTypes, orders, orderCount, paidSummary, statusCounts] = await Promise.all([
    EventModel.findById(eventId).populate("creatorId", "firstName lastName email status").lean(),
    TicketTypeModel.find({ eventId }).sort({ createdAt: 1 }).lean(),
    TicketOrderModel.find(orderFilter)
      .select("orderNumber buyerId ticketTypeId quantity ticketSubtotalKobo platformFeeKobo totalKobo organizerProceedsKobo status checkoutClient paidAt createdAt checkedInAt checkedInBy")
      .populate("buyerId", "firstName lastName email")
      .populate("ticketTypeId", "title priceKobo")
      .populate("checkedInBy", "firstName lastName")
      .sort({ paidAt: -1, createdAt: -1 })
      .skip((page - 1) * 50)
      .limit(50)
      .lean(),
    TicketOrderModel.countDocuments(orderFilter),
    TicketOrderModel.aggregate<{ orders: number; tickets: number; grossKobo: number }>([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId), status: "paid" } },
      { $group: { _id: null, orders: { $sum: 1 }, tickets: { $sum: "$quantity" }, grossKobo: { $sum: "$totalKobo" } } },
    ]),
    TicketOrderModel.aggregate<{ _id: string; count: number }>([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  if (!event) throw new AppError(404, "Event was not found", "EVENT_NOT_FOUND");
  response.setHeader("Cache-Control", "no-store");
  response.render("admin/event-detail", {
    title: `${event.title} · Event details`,
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "events",
    event,
    ticketTypes,
    orders,
    status,
    page,
    orderCount,
    pageCount: Math.max(1, Math.ceil(orderCount / 50)),
    paidSummary: paidSummary[0] || { orders: 0, tickets: 0, grossKobo: 0 },
    statusCounts: Object.fromEntries(statusCounts.map((item) => [item._id, item.count])),
    formatNaira,
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
  });
};

export const renderAdminCommunities = async (request: Request, response: Response): Promise<void> => {
  const page = parsePage(request.query.page);
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 80) : "";
  const selectedStatus = request.query.status === "deactivated" ? "deactivated" : "active";
  const query: Record<string, unknown> = selectedStatus === "active"
    ? { isActive: { $ne: false } }
    : { isActive: false };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { slug: { $regex: escaped, $options: "i" } },
      { category: { $regex: escaped, $options: "i" } },
    ];
  }

  const [communities, total, activeCount, deactivatedCount] = await Promise.all([
    CommunityModel.find(query)
      .select("name slug description coverImageUrl avatarImageUrl imageUrl category state lga visibility membershipType membershipPriceKobo ownerId isActive createdAt lastActivityAt")
      .populate("ownerId", "firstName lastName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * 30)
      .limit(30)
      .lean(),
    CommunityModel.countDocuments(query),
    CommunityModel.countDocuments({ isActive: { $ne: false } }),
    CommunityModel.countDocuments({ isActive: false }),
  ]);

  response.setHeader("Cache-Control", "no-store");
  response.render("admin/communities", {
    title: "Communities · Community Connect Admin",
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "communities",
    communities,
    total,
    activeCount,
    deactivatedCount,
    page,
    pageCount: Math.max(1, Math.ceil(total / 30)),
    selectedStatus,
    search,
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
  });
};

export const renderAdminCommunityDetails = async (request: Request, response: Response): Promise<void> => {
  const communityId = parseId(request.params.id, "Community");
  const page = parsePage(request.query.page);
  const [community, owner, members, memberCount, memberStats, orders, orderCount, content] = await Promise.all([
    CommunityModel.findById(communityId)
      .select("+adminDeactivatedAt +adminDeactivatedBy +adminDeactivationReason +adminActivatedAt +adminActivatedBy")
      .populate("ownerId", "firstName lastName email")
      .populate("adminDeactivatedBy", "firstName lastName")
      .populate("adminActivatedBy", "firstName lastName")
      .lean(),
    CommunityModel.findById(communityId).select("ownerId").lean(),
    CommunityMemberModel.find({ communityId }).populate("userId", "firstName lastName status").sort({ joinedAt: -1 }).skip((page - 1) * 25).limit(25).lean(),
    CommunityMemberModel.countDocuments({ communityId }),
    CommunityMemberModel.aggregate<{ _id: string; count: number }>([
      { $match: { communityId: new mongoose.Types.ObjectId(communityId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    CommunityMembershipOrderModel.find({ communityId, status: { $in: ["paid", "refunded"] } })
      .populate("buyerId", "firstName lastName email")
      .sort({ paidAt: -1 })
      .limit(25)
      .lean(),
    CommunityMembershipOrderModel.countDocuments({ communityId, status: "paid" }),
    CommunityContentModel.find({ communityId }).populate("authorId", "firstName lastName")
      .sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  if (!community) throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  response.setHeader("Cache-Control", "no-store");
  response.render("admin/community-detail", {
    title: `${community.name} · Community details`,
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "communities",
    community,
    members,
    memberCount,
    memberStats: Object.fromEntries(memberStats.map((item) => [item._id, item.count])),
    orders,
    orderCount,
    owner: owner?.ownerId,
    content,
    page,
    pageCount: Math.max(1, Math.ceil(memberCount / 25)),
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
    formatNaira,
  });
};

export const setAdminCommunityStatus = async (request: Request, response: Response): Promise<void> => {
  const communityId = parseId(request.params.id, "Community");
  const parsed = z.object({
    isActive: z.enum(["true", "false"]),
    reason: z.string().trim().max(300).optional(),
    _csrf: z.string().min(32).max(256),
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError(422, "Choose a valid community status", "VALIDATION_ERROR");
  const isActive = parsed.data.isActive === "true";
  const reason = parsed.data.reason || "";
  if (!isActive && reason.length < 5) {
    throw new AppError(422, "Enter a reason of at least 5 characters", "DEACTIVATION_REASON_REQUIRED");
  }

  const update = isActive
    ? { $set: { isActive: true, adminActivatedAt: new Date(), adminActivatedBy: adminId(request) } }
    : { $set: { isActive: false, adminDeactivatedAt: new Date(), adminDeactivatedBy: adminId(request), adminDeactivationReason: reason } };
  const community = await CommunityModel.findByIdAndUpdate(communityId, update, { new: true, runValidators: true });
  if (!community) throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  if (!isActive) {
    const room = `community:${communityId}`;
    const chatNamespace = request.app.get("io") as Namespace | undefined;
    await chatNamespace?.in(room).socketsLeave(room);
  }

  logger.info({ actorAdminId: request.admin?.adminId, communityId, isActive }, "Community moderation status changed");
  redirectWithMessage(response, `/admin/communities/${communityId}`, isActive ? "Community activated." : "Community deactivated.");
};

export const renderAdminReports = async (request: Request, response: Response): Promise<void> => {
  const page = parsePage(request.query.page);
  const statuses = ["open", "reviewing", "resolved", "dismissed", "all"] as const;
  const requestedStatus = typeof request.query.status === "string" ? request.query.status : "open";
  const status = statuses.includes(requestedStatus as typeof statuses[number])
    ? requestedStatus as typeof statuses[number]
    : "open";
  const query = status === "all" ? {} : { status };
  const [reports, total, counts] = await Promise.all([
    ReportModel.find(query).populate("reporterId", "firstName lastName status")
      .sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30).lean(),
    ReportModel.countDocuments(query),
    ReportModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const idsFor = (targetType: string) => reports
    .filter((report) => report.targetType === targetType)
    .map((report) => report.targetId);
  const [events, communities, users, messages] = await Promise.all([
    EventModel.find({ _id: { $in: idsFor("event") } }).select("title status coverImageUrl state lga startsAt endsAt").lean(),
    CommunityModel.find({ _id: { $in: idsFor("community") } }).select("name slug isActive visibility coverImageUrl state lga").lean(),
    UserModel.find({ _id: { $in: idsFor("user") } }).select("firstName lastName role status").lean(),
    CommunityContentModel.find({ _id: { $in: idsFor("community_message") } })
      .select("communityId authorId kind text createdAt deletedAt")
      .populate("communityId", "name")
      .populate("authorId", "firstName lastName")
      .lean(),
  ]);
  const targets = new Map<string, unknown>();
  [...events, ...communities, ...users, ...messages].forEach((target) => targets.set(String(target._id), target));
  const reportsWithTargets = reports.map((report) => ({
    ...report,
    target: targets.get(String(report.targetId)) || null,
  }));

  response.setHeader("Cache-Control", "no-store");
  response.render("admin/reports", {
    title: "Reports · Community Connect Admin",
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "reports",
    reports: reportsWithTargets,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / 30)),
    status,
    counts: Object.fromEntries(counts.map((item) => [item._id, item.count])),
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
  });
};

export const updateAdminReport = async (request: Request, response: Response): Promise<void> => {
  const reportId = parseId(request.params.id, "Report");
  const parsed = z.object({
    status: z.enum(["reviewing", "resolved", "dismissed"]),
    resolution: z.string().trim().max(2000).optional(),
    _csrf: z.string().min(32).max(256),
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError(422, "Choose a valid report action", "VALIDATION_ERROR");
  const resolution = parsed.data.resolution || "";
  if (parsed.data.status !== "reviewing" && resolution.length < 5) {
    throw new AppError(422, "Add a resolution note of at least 5 characters", "REPORT_RESOLUTION_REQUIRED");
  }

  const report = await ReportModel.findOneAndUpdate(
    { _id: reportId, status: { $in: ["open", "reviewing"] } },
    { $set: {
      status: parsed.data.status,
      reviewedBy: adminId(request),
      reviewedAt: new Date(),
      ...(resolution ? { resolution } : {}),
    } },
    { new: true, runValidators: true },
  );
  if (!report) throw new AppError(409, "This report has already been closed or could not be found", "REPORT_ALREADY_CLOSED");

  logger.info({ actorAdminId: request.admin?.adminId, reportId, status: report.status }, "Report reviewed in admin portal");
  redirectWithMessage(response, "/admin/reports", "Report marked " + report.status + ".");
};
