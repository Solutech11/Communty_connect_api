import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../Config/env";
import { uploadImageController } from "../../Controller/upload.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { AppError } from "../../utils/AppError";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError(415, "Only JPEG, PNG, and WebP images are allowed", "UNSUPPORTED_IMAGE_TYPE"));
      return;
    }
    callback(null, true);
  },
});

router.post(
  "/images",
  authenticate,
  upload.single("image"),
  validate({ body: z.object({ folder: z.enum(["avatars", "events", "communities", "disputes", "chat", "uploads"]).default("uploads") }).passthrough() }),
  asyncHandler(uploadImageController),
);

export default router;

