import type { Request, Response } from "express";
import { UserModel } from "../models/Auth/User.model";
import { CommunityModel } from "../models/Community/Community.model";
import { EventModel } from "../models/Event/Event.model";
import { ReportModel } from "../models/Report/Report.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

type ReportTargetType = "event" | "community" | "user";

const assertReportableTarget = async (
  targetType: ReportTargetType,
  targetId: string,
  reporterId: string,
): Promise<void> => {
  if (targetType === "event") {
    const event = await EventModel.findOne({ _id: targetId, status: "published" })
      .select("creatorId")
      .lean();
    if (!event) {
      throw new AppError(404, "Event was not found", "EVENT_NOT_FOUND");
    }
    if (event.creatorId.toString() === reporterId) {
      throw new AppError(400, "You cannot report your own event", "INVALID_REPORT_TARGET");
    }
    return;
  }

  if (targetType === "community") {
    const community = await CommunityModel.findOne({
      _id: targetId,
      $or: [{ visibility: "public" }, { members: reporterId }, { ownerId: reporterId }],
    }).select("ownerId").lean();
    if (!community) {
      throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
    }
    if (community.ownerId.toString() === reporterId) {
      throw new AppError(400, "You cannot report your own community", "INVALID_REPORT_TARGET");
    }
    return;
  }

  if (targetId === reporterId) {
    throw new AppError(400, "You cannot report your own account", "INVALID_REPORT_TARGET");
  }
  if (!(await UserModel.exists({ _id: targetId, status: "active" }))) {
    throw new AppError(404, "User was not found", "USER_NOT_FOUND");
  }
};

export const createTargetReport = (targetType: ReportTargetType) => {
  return async (request: Request, response: Response): Promise<Response> => {
    const reporterId = request.auth?.id as string;
    const targetId = request.params.id as string;
    await assertReportableTarget(targetType, targetId, reporterId);

    const duplicate = await ReportModel.exists({
      reporterId,
      targetType,
      targetId,
      status: { $in: ["open", "reviewing"] },
    });
    if (duplicate) {
      throw new AppError(
        409,
        "You already have an active report for this resource",
        "REPORT_ALREADY_OPEN",
      );
    }

    const report = await ReportModel.create({
      reporterId,
      targetType,
      targetId,
      reason: request.body.reason,
      details: request.body.details,
    });

    // Reporter identity is retained for abuse prevention but omitted from this
    // acknowledgement so the client can treat reports as confidential.
    return sendSuccess(response, 201, "Report submitted", {
      report: {
        _id: report._id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  };
};
