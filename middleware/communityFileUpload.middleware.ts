import multer from "multer";
import { env } from "../Config/env";
import { AppError } from "../utils/AppError";

const allowedFileMimeTypes = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const communityFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_COMMUNITY_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedFileMimeTypes.has(file.mimetype)) {
      callback(new AppError(415, "This file type is not allowed", "UNSUPPORTED_FILE_TYPE"));
      return;
    }
    callback(null, true);
  },
});
