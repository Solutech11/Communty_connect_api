import { Router } from "express";
import { z } from "zod";
import { uploadImageController } from "../../Controller/upload.controller";
import { uploadCommunityFileController } from "../../Controller/communityFileUpload.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { imageUpload } from "../../middleware/imageUpload.middleware";
import { communityFileUpload } from "../../middleware/communityFileUpload.middleware";
import { validate } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();

router.post(
  "/images",
  authenticate,
  imageUpload.single("image"),
  validate({ body: z.object({ folder: z.enum(["avatars", "events", "communities", "disputes", "chat", "uploads"]).default("uploads") }).passthrough() }),
  asyncHandler(uploadImageController),
);

router.post(
  "/files",
  authenticate,
  communityFileUpload.single("file"),
  validate({ body: z.object({ folder: z.literal("community-chat") }).strict() }),
  asyncHandler(uploadCommunityFileController),
);
export default router;
