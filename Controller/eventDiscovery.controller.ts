import type { Request, Response } from "express";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { sendSuccess } from "../utils/response.utils";

type DiscoverySection = "trending" | "recent" | "past";

export const discoveryFilter = (section: DiscoverySection, state: string | undefined, now: Date) => ({
  status: "published" as const,
  ...(section === "past" ? { endsAt: { $lt: now } } : { startsAt: { $gte: now } }),
  ...(state ? { state } : {}),
});

export const discoverySort = (section: Exclude<DiscoverySection, "trending">): Record<string, 1 | -1> =>
  section === "recent"
    ? { publishedAt: -1 as const, startsAt: 1 as const, _id: 1 as const }
    : { endsAt: -1 as const, _id: 1 as const };

export const listDiscoverEvents = async (request: Request, response: Response): Promise<Response> => {
  const section = request.query.section as DiscoverySection;
  const state = request.query.state as string | undefined;
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const now = new Date();
  const query = discoveryFilter(section, state, now);

  const total = await EventModel.countDocuments(query);
  if (section === "trending") {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const events = await EventModel.aggregate([
      { $match: query },
      {
        $lookup: {
          from: TicketOrderModel.collection.name,
          let: { eventId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$eventId", "$$eventId"] },
                status: "paid",
                $or: [{ paidAt: { $gte: since } }, { paidAt: { $exists: false }, updatedAt: { $gte: since } }],
              },
            },
            { $group: { _id: null, count: { $sum: "$quantity" } } },
          ],
          as: "recentSales",
        },
      },
      { $addFields: { trendingTickets: { $ifNull: [{ $first: "$recentSales.count" }, 0] } } },
      { $unset: "recentSales" },
      { $sort: { trendingTickets: -1, startsAt: 1, _id: 1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);
    await EventModel.populate(events, { path: "creatorId", select: "firstName lastName avatarUrl" });
    return sendSuccess(response, 200, "Discovery events retrieved", {
      events, section, pagination: { page, limit, total },
    });
  }

  const events = await EventModel.find(query)
    .populate("creatorId", "firstName lastName avatarUrl")
    .sort(discoverySort(section))
    .skip((page - 1) * limit)
    .limit(limit);
  return sendSuccess(response, 200, "Discovery events retrieved", {
    events, section, pagination: { page, limit, total },
  });
};
