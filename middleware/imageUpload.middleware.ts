import multer from "multer";
import { env } from "../Config/env";
import { AppError } from "../utils/AppError";

const allowedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      callback(new AppError(415, "Only JPEG, PNG, and WebP images are allowed", "UNSUPPORTED_IMAGE_TYPE"));
      return;
    }

    callback(null, true);
  },
});