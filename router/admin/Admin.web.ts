import { Router } from "express";
import {
  approveEventFromAdmin,
  deactivateEventFromAdmin,
  loginAdmin,
  logoutAdmin,
  renderAdminDashboard,
  renderAdminLogin,
} from "../../Controller/admin.controller";
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
router.post("/logout", requireAdminCsrf, asyncHandler(logoutAdmin));
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
