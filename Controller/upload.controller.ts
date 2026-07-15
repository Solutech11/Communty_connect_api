import type { Request, Response } from "express";
import { AppError } from "../utils/AppError";
import { uploadImage } from "../utils/cloudinary.utils";
import { sendSuccess } from "../utils/response.utils";

export const uploadImageController = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  if (!request.file) {
    throw new AppError(400, "An image file is required", "IMAGE_REQUIRED");
  }

  const result = await uploadImage(request.file.buffer, request.body.folder || "uploads");
  return sendSuccess(response, 201, "Image uploaded", result);
};

