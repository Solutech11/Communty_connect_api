import path from "node:path";
import type { Request, Response } from "express";
import { CommunityAttachmentModel } from "../models/Community/CommunityAttachment.model";
import { AppError } from "../utils/AppError";
import { toCommunityAttachment } from "../utils/communityContentPresentation.utils";
import { uploadCommunityFile } from "../utils/cloudinary.utils";
import { sendSuccess } from "../utils/response.utils";

const isPdf = (buffer: Buffer): boolean => buffer.subarray(0, 5).toString("ascii") === "%PDF-";

export const uploadCommunityFileController = async (request: Request, response: Response): Promise<Response> => {
  if (!request.file) {
    throw new AppError(400, "A file is required", "FILE_REQUIRED");
  }
  if (request.file.mimetype === "application/pdf" && !isPdf(request.file.buffer)) {
    throw new AppError(415, "The uploaded file is not a valid PDF", "UNSUPPORTED_FILE_TYPE");
  }
  const result = await uploadCommunityFile(request.file.buffer, request.file.mimetype);
  const type = request.file.mimetype.startsWith("image/")
    ? "image"
    : request.file.mimetype === "application/pdf"
      ? "pdf"
      : "file";
  const attachment = await CommunityAttachmentModel.create({
    ownerId: request.auth?.id,
    url: result.url,
    publicId: result.publicId,
    type,
    name: path.basename(request.file.originalname).slice(0, 255) || "attachment",
    mimeType: request.file.mimetype,
    sizeBytes: request.file.size,
    thumbnailUrl: null,
  });
  return sendSuccess(response, 201, "Community file uploaded", {
    attachment: toCommunityAttachment(attachment),
  });
};
