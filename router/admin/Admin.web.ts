import { Router } from "express";
import {
  approveEventFromAdmin,
  blockUserFromAdmin,
  createAdminFromPortal,
  deactivateEventFromAdmin,
  loginAdmin,
  logoutAdmin,
  renderAdminDashboard,
  renderAdminLogin,
  unblockUserFromAdmin,
} from "../../Controller/admin.controller";
import {
  renderAdminCommunities,
  renderAdminCommunityDetails,
  renderAdminEvents,
  renderAdminEventDetails,
  renderAdminReports,
  setAdminCommunityStatus,
  updateAdminReport,
} from "../../Controller/adminModeration.controller";
import {
  authenticateAdminPage,
  requireAdminCsrf,
  requireAdminPermission,
} from "../../middleware/admin.middleware";
import { authRateLimiter } from "../../middleware/security.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();

router.get("/login", asyncHandler(renderAdminLogin));
router.post("/login", authRateLimiter, asyncHandler(loginAdmin));
router.use(authenticateAdminPage);
router.get(
  "/",
  requireAdminPermission("users:read"),
  requireAdminPermission("earnings:read"),
  asyncHandler(renderAdminDashboard),
);
router.get("/events", requireAdminPermission("events:moderate"), asyncHandler(renderAdminEvents));
router.get("/events/:id", requireAdminPermission("events:moderate"), asyncHandler(renderAdminEventDetails));
router.get("/communities", requireAdminPermission("communities:moderate"), asyncHandler(renderAdminCommunities));
router.get("/communities/:id", requireAdminPermission("communities:moderate"), asyncHandler(renderAdminCommunityDetails));
router.post("/communities/:id/status", requireAdminPermission("communities:moderate"), requireAdminCsrf, asyncHandler(setAdminCommunityStatus));
router.get("/reports", requireAdminPermission("reports:moderate"), asyncHandler(renderAdminReports));
router.post("/reports/:id/status", requireAdminPermission("reports:moderate"), requireAdminCsrf, asyncHandler(updateAdminReport));
router.post("/logout", requireAdminCsrf, asyncHandler(logoutAdmin));
router.post(
  "/admins",
  requireAdminPermission("admins:manage"),
  requireAdminCsrf,
  asyncHandler(createAdminFromPortal),
);
router.post(
  "/users/:id/block",
  requireAdminPermission("users:moderate"),
  requireAdminCsrf,
  asyncHandler(blockUserFromAdmin),
);
router.post(
  "/users/:id/unblock",
  requireAdminPermission("users:moderate"),
  requireAdminCsrf,
  asyncHandler(unblockUserFromAdmin),
);
router.post(
  "/events/:id/approve",
  requireAdminPermission("events:moderate"),
  requireAdminCsrf,
  asyncHandler(approveEventFromAdmin),
);
router.post(
  "/events/:id/deactivate",
  requireAdminPermission("events:moderate"),
  requireAdminCsrf,
  asyncHandler(deactivateEventFromAdmin),
);

export default router;
