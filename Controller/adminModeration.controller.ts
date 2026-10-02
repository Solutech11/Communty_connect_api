import type { Request, Response } from "express";
import type { Namespace } from "socket.io";
import mongoose from "mongoose";
import { z } from "zod";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityAttachmentModel } from "../models/Community/CommunityAttachment.model";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { CommunityJoinRequestModel } from "../models/Community/CommunityJoinRequest.model";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";
import { CommunityMembershipOrderModel } from "../models/Community/CommunityMembershipOrder.model";
import { DisputeModel } from "../models/Dispute/Dispute.model";
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
  response.redirect(`${path}${path.includes("?") ? "&" : "?"}message=${encodeURIComponent(message)}`);
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
  const memberPage = parsePage(request.query.memberPage || request.query.page);
  const orderPage = parsePage(request.query.orderPage);
  const contentPage = parsePage(request.query.contentPage);
  const orderQuery = { communityId };
  const [community, members, memberCount, memberStats, orders, orderCount, paidOrderCount, orderStatusCounts, content, contentCount, joinRequests, joinRequestCounts] = await Promise.all([
    CommunityModel.findById(communityId)
      .select("+adminDeactivatedAt +adminDeactivatedBy +adminDeactivationReason +adminActivatedAt +adminActivatedBy")
      .populate("ownerId", "firstName lastName email")
      .populate("adminDeactivatedBy", "firstName lastName")
      .populate("adminActivatedBy", "firstName lastName")
      .populate("rulesUpdatedBy", "firstName lastName")
      .lean(),
    CommunityMemberModel.find({ communityId }).populate("userId", "firstName lastName email status").sort({ joinedAt: -1 }).skip((memberPage - 1) * 25).limit(25).lean(),
    CommunityMemberModel.countDocuments({ communityId }),
    CommunityMemberModel.aggregate<{ _id: string; count: number }>([
      { $match: { communityId: new mongoose.Types.ObjectId(communityId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    CommunityMembershipOrderModel.find(orderQuery)
      .populate("buyerId", "firstName lastName email")
      .sort({ createdAt: -1, paidAt: -1 })
      .skip((orderPage - 1) * 25)
      .limit(25)
      .lean(),
    CommunityMembershipOrderModel.countDocuments(orderQuery),
    CommunityMembershipOrderModel.countDocuments({ communityId, status: "paid" }),
    CommunityMembershipOrderModel.aggregate<{ _id: string; count: number }>([
      { $match: { communityId: new mongoose.Types.ObjectId(communityId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    CommunityContentModel.find({ communityId })
      .populate("authorId", "firstName lastName")
      .populate({ path: "attachments", model: CommunityAttachmentModel, select: "url thumbnailUrl type name mimeType sizeBytes" })
      .sort({ createdAt: -1 })
      .skip((contentPage - 1) * 20)
      .limit(20)
      .lean(),
    CommunityContentModel.countDocuments({ communityId }),
    CommunityJoinRequestModel.find({ communityId })
      .populate("requesterId", "firstName lastName email status")
      .populate("reviewedBy", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    CommunityJoinRequestModel.aggregate<{ _id: string; count: number }>([
      { $match: { communityId: new mongoose.Types.ObjectId(communityId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
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
    paidOrderCount,
    orderStatusCounts: Object.fromEntries(orderStatusCounts.map((item) => [item._id, item.count])),
    joinRequests,
    joinRequestCounts: Object.fromEntries(joinRequestCounts.map((item) => [item._id, item.count])),
    content,
    memberPage,
    memberPageCount: Math.max(1, Math.ceil(memberCount / 25)),
    orderPage,
    orderPageCount: Math.max(1, Math.ceil(orderCount / 25)),
    contentCount,
    contentPage,
    contentPageCount: Math.max(1, Math.ceil(contentCount / 20)),
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
  const reportStatuses = ["all", "open", "reviewing", "resolved", "dismissed"] as const;
  const disputeStatuses = ["all", "open", "under_review", "awaiting_user", "resolved", "closed"] as const;
  const reportTargetTypes = ["all", "event", "community", "user", "community_message"] as const;
  const requestedReportStatus = typeof request.query.reportStatus === "string"
    ? request.query.reportStatus
    : typeof request.query.status === "string" ? request.query.status : "all";
  const reportStatus = reportStatuses.includes(requestedReportStatus as typeof reportStatuses[number])
    ? requestedReportStatus as typeof reportStatuses[number]
    : "all";
  const requestedDisputeStatus = typeof request.query.disputeStatus === "string" ? request.query.disputeStatus : "all";
  const disputeStatus = disputeStatuses.includes(requestedDisputeStatus as typeof disputeStatuses[number])
    ? requestedDisputeStatus as typeof disputeStatuses[number]
    : "all";
  const requestedTargetType = typeof request.query.reportTargetType === "string" ? request.query.reportTargetType : "all";
  const reportTargetType = reportTargetTypes.includes(requestedTargetType as typeof reportTargetTypes[number])
    ? requestedTargetType as typeof reportTargetTypes[number]
    : "all";
  const reportPage = parsePage(request.query.reportPage || request.query.page);
  const disputePage = parsePage(request.query.disputePage);
  const reportQuery: Record<string, unknown> = {};
  const disputeQuery: Record<string, unknown> = {};
  if (reportStatus !== "all") reportQuery.status = reportStatus;
  if (reportTargetType !== "all") reportQuery.targetType = reportTargetType;
  if (disputeStatus !== "all") disputeQuery.status = disputeStatus;

  const [reports, reportTotal, reportCounts, disputes, disputeTotal, disputeCounts] = await Promise.all([
    ReportModel.find(reportQuery).populate("reporterId", "firstName lastName status")
      .sort({ createdAt: -1 }).skip((reportPage - 1) * 25).limit(25).lean(),
    ReportModel.countDocuments(reportQuery),
    ReportModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    DisputeModel.find(disputeQuery)
      .populate("userId", "firstName lastName email status")
      .populate("transactionId", "reference type direction amountKobo feeKobo currency status title completedAt")
      .populate("assignedTo", "firstName lastName")
      .populate("messages.authorId", "firstName lastName role")
      .sort({ createdAt: -1 }).skip((disputePage - 1) * 25).limit(25).lean(),
    DisputeModel.countDocuments(disputeQuery),
    DisputeModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const idsFor = (targetType: string) => reports
    .filter((report) => report.targetType === targetType)
    .map((report) => report.targetId);
  const [events, communities, users, messages] = await Promise.all([
    EventModel.find({ _id: { $in: idsFor("event") } }).select("title status coverImageUrl state lga startsAt endsAt").lean(),
    CommunityModel.find({ _id: { $in: idsFor("community") } }).select("name slug isActive visibility coverImageUrl state lga").lean(),
    UserModel.find({ _id: { $in: idsFor("user") } }).select("firstName lastName email role status").lean(),
    CommunityContentModel.find({ _id: { $in: idsFor("community_message") } })
      .select("communityId authorId kind text imageUrl attachments createdAt deletedAt")
      .populate("communityId", "name slug isActive")
      .populate("authorId", "firstName lastName")
      .populate({ path: "attachments", model: CommunityAttachmentModel, select: "url thumbnailUrl type name mimeType sizeBytes" })
      .lean(),
  ]);
  const targets = new Map<string, unknown>();
  events.forEach((target) => targets.set(`event:${target._id}`, target));
  communities.forEach((target) => targets.set(`community:${target._id}`, target));
  users.forEach((target) => targets.set(`user:${target._id}`, target));
  messages.forEach((target) => targets.set(`community_message:${target._id}`, target));
  const reportsWithTargets = reports.map((report) => ({
    ...report,
    target: targets.get(`${report.targetType}:${report.targetId}`) || null,
  }));

  response.setHeader("Cache-Control", "no-store");
  response.render("admin/reports", {
    title: "Reports and app issues · Community Connect Admin",
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    activeTab: "reports",
    reports: reportsWithTargets,
    reportTotal,
    reportPage,
    reportPageCount: Math.max(1, Math.ceil(reportTotal / 25)),
    reportStatus,
    reportTargetType,
    reportCounts: Object.fromEntries(reportCounts.map((item) => [item._id, item.count])),
    disputes,
    disputeTotal,
    disputePage,
    disputePageCount: Math.max(1, Math.ceil(disputeTotal / 25)),
    disputeStatus,
    disputeCounts: Object.fromEntries(disputeCounts.map((item) => [item._id, item.count])),
    formatNaira,
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

export const replyToAdminDispute = async (request: Request, response: Response): Promise<void> => {
  const disputeId = parseId(request.params.id, "Dispute");
  const parsed = z.object({
    message: z.string().trim().min(1).max(3000),
    internal: z.enum(["true"]).optional(),
    _csrf: z.string().min(32).max(256),
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError(422, "Enter a valid dispute reply", "VALIDATION_ERROR");

  const dispute = await DisputeModel.findById(disputeId);
  if (!dispute) throw new AppError(404, "Dispute was not found", "DISPUTE_NOT_FOUND");
  if (["resolved", "closed"].includes(dispute.status)) {
    throw new AppError(409, "This dispute cannot receive replies", "DISPUTE_NOT_REPLYABLE");
  }

  const internal = parsed.data.internal === "true";
  dispute.messages.push({
    authorId: adminId(request),
    message: parsed.data.message,
    internal,
  } as never);
  if (internal && dispute.status === "open") dispute.status = "under_review";
  if (!internal) dispute.status = "awaiting_user";
  await dispute.save();

  logger.info({ actorAdminId: request.admin?.adminId, disputeId, internal }, "Admin replied to app issue dispute");
  redirectWithMessage(response, `/admin/reports?disputeStatus=${encodeURIComponent(dispute.status)}`, "Reply added to dispute.");
};

export const updateAdminDisputeStatus = async (request: Request, response: Response): Promise<void> => {
  const disputeId = parseId(request.params.id, "Dispute");
  const parsed = z.object({
    status: z.enum(["open", "under_review", "awaiting_user", "resolved", "closed"]),
    resolution: z.string().trim().max(3000).optional(),
    _csrf: z.string().min(32).max(256),
  }).strict().safeParse(request.body);
  if (!parsed.success) throw new AppError(422, "Choose a valid dispute status", "VALIDATION_ERROR");

  const resolution = parsed.data.resolution || "";
  if (["resolved", "closed"].includes(parsed.data.status) && resolution.length < 5) {
    throw new AppError(422, "Add a resolution note of at least 5 characters", "DISPUTE_RESOLUTION_REQUIRED");
  }

  const dispute = await DisputeModel.findById(disputeId);
  if (!dispute) throw new AppError(404, "Dispute was not found", "DISPUTE_NOT_FOUND");
  dispute.status = parsed.data.status;
  if (["resolved", "closed"].includes(dispute.status)) {
    dispute.resolvedAt = new Date();
    dispute.resolution = resolution;
  } else {
    dispute.resolvedAt = undefined;
    dispute.resolution = undefined;
  }
  await dispute.save();

  logger.info({ actorAdminId: request.admin?.adminId, disputeId, status: dispute.status }, "App issue dispute status changed");
  redirectWithMessage(response, `/admin/reports?disputeStatus=${encodeURIComponent(dispute.status)}`, "Dispute marked " + dispute.status.replaceAll("_", " ") + ".");
};
