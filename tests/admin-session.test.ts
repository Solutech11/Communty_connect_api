import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import test, { type TestContext } from "node:test";
import bcrypt from "bcrypt";
import express from "express";
import mongoose from "mongoose";
import "./test-env";
import { loginAdmin, logoutAdmin, renderAdminLogin } from "../Controller/admin.controller";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_LOGIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  authenticateAdminPage,
  requireAdminCsrf,
} from "../middleware/admin.middleware";
import { AdminModel } from "../models/Admin/Admin.model";
import { AdminSessionModel, type AdminSession } from "../models/Admin/AdminSession.model";
import { UserModel } from "../models/Auth/User.model";
import { asyncHandler } from "../utils/asyncHandler.utils";

type StoredSession = AdminSession & { _id: mongoose.Types.ObjectId };

const createPortal = async (context: TestContext) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    role: "admin",
    status: "active",
    passwordHash: await bcrypt.hash("Admin-test-password-123!", 4),
  };
  const admin = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    active: true,
    permissions: ["users:read"],
  };
  const sessions: StoredSession[] = [];

  context.mock.method(UserModel, "findOne", (query: Record<string, unknown>) => {
    const result = query.role === user.role && (!query.status || query.status === user.status)
      ? user
      : null;
    return { select: async () => result, lean: async () => result };
  });
  context.mock.method(AdminModel, "findOneAndUpdate", async () => admin);
  context.mock.method(AdminModel, "findOne", () => ({
    lean: async () => admin.active ? admin : null,
  }));
  context.mock.method(AdminSessionModel, "create", async (values: AdminSession) => {
    const session = { ...values, _id: new mongoose.Types.ObjectId() };
    sessions.push(session);
    return session;
  });
  context.mock.method(AdminSessionModel, "findOne", (query: {
    tokenHash: string;
    revokedAt: { $exists: boolean };
    expiresAt: { $gt: Date };
  }) => {
    assert.deepEqual(query.revokedAt, { $exists: false });
    const session = sessions.find((value) => value.tokenHash === query.tokenHash
      && !value.revokedAt
      && value.expiresAt > query.expiresAt.$gt);
    return { select: async () => session ?? null };
  });
  context.mock.method(AdminSessionModel, "updateOne", async (
    query: { _id: string },
    update: { revokedAt: Date },
  ) => {
    const session = sessions.find((value) => value._id.toString() === query._id);
    if (session) {
      session.revokedAt = update.revokedAt;
    }
    return { acknowledged: true };
  });

  const app = express();
  app.set("trust proxy", 1);
  app.set("views", path.resolve("views"));
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: false }));
  app.get("/admin/login", asyncHandler(renderAdminLogin));
  app.post("/admin/login", asyncHandler(loginAdmin));
  app.use("/admin", authenticateAdminPage);
  app.get("/admin", (request, response) => {
    response.json({ userId: request.admin?.userId, tab: request.query.tab });
  });
  app.post("/admin/action", requireAdminCsrf, (_request, response) => {
    response.sendStatus(204);
  });
  app.post("/admin/logout", requireAdminCsrf, asyncHandler(logoutAdmin));

  const server = app.listen(0, "127.0.0.1");
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const request = (route: string, cookies = "", ip = "192.0.2.10", options: RequestInit = {}) => {
    return fetch(baseUrl + route, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Admin regression test browser",
        "X-Forwarded-For": ip,
        Cookie: cookies,
        ...options.headers,
      },
    });
  };
  const signIn = async () => {
    const form = await request("/admin/login");
    assert.equal(form.status, 200);
    const loginCookie = form.headers.getSetCookie().find((cookie) => cookie.startsWith(ADMIN_LOGIN_CSRF_COOKIE + "="));
    assert.ok(loginCookie);
    const csrfToken = loginCookie.split(";")[0]!.split("=")[1]!;
    const response = await request("/admin/login", loginCookie.split(";")[0], "192.0.2.10", {
      method: "POST",
      body: new URLSearchParams({ email: "admin@example.com", password: "Admin-test-password-123!", _csrf: csrfToken }),
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin");
    const cookies = response.headers.getSetCookie()
      .filter((cookie) => cookie.startsWith(ADMIN_SESSION_COOKIE + "=") || cookie.startsWith(ADMIN_CSRF_COOKIE + "="))
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const csrf = cookies.split("; ").find((cookie) => cookie.startsWith(ADMIN_CSRF_COOKIE + "="))!.split("=")[1]!;
    return { cookies, csrf };
  };

  return { request, signIn, sessions, user, admin };
};

test("admin login survives IP changes on the first dashboard request and across tabs", async (context) => {
  const portal = await createPortal(context);
  const { cookies, csrf } = await portal.signIn();
  for (const [tab, ip] of [["overview", "192.0.2.11"], ["members", "2001:db8::2"], ["finance", "192.0.2.10"]]) {
    const response = await portal.request("/admin?tab=" + tab, cookies, ip);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).userId, portal.user._id.toString());
  }
  const action = await portal.request("/admin/action", cookies, "192.0.2.12", {
    method: "POST",
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.equal(action.status, 204);
});

test("stale admin cookies render a usable login page without a redirect loop", async (context) => {
  const portal = await createPortal(context);
  const { cookies } = await portal.signIn();
  portal.sessions[0]!.expiresAt = new Date(Date.now() - 1000);
  const response = await portal.request("/admin/login", cookies);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /action="\/admin\/login"/);
  const cleared = response.headers.getSetCookie();
  assert.ok(cleared.some((cookie) => cookie.startsWith(ADMIN_SESSION_COOKIE + "=;")));
  assert.ok(cleared.some((cookie) => cookie.startsWith(ADMIN_CSRF_COOKIE + "=;")));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("valid admin sessions visiting login return to the dashboard", async (context) => {
  const portal = await createPortal(context);
  const { cookies } = await portal.signIn();
  const response = await portal.request("/admin/login", cookies, "192.0.2.12");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin");
});

test("admin sessions still enforce expiry, revocation, cookie integrity and active accounts", async (context) => {
  const cases = ["missing", "forged-token", "forged-csrf", "expired", "revoked", "changed-browser", "inactive-admin", "blocked-user", "demoted-user"];
  for (const scenario of cases) {
    await context.test(scenario, async (child) => {
      const portal = await createPortal(child);
      const login = await portal.signIn();
      let cookies = login.cookies;
      let headers = {};
      if (scenario === "missing") {
        cookies = "";
      }
      if (scenario === "forged-token") {
        cookies = cookies.replace(ADMIN_SESSION_COOKIE + "=", ADMIN_SESSION_COOKIE + "=forged");
      }
      if (scenario === "forged-csrf") {
        cookies = cookies.replace(ADMIN_CSRF_COOKIE + "=", ADMIN_CSRF_COOKIE + "=forged");
      }
      if (scenario === "expired") {
        portal.sessions[0]!.expiresAt = new Date(Date.now() - 1000);
      }
      if (scenario === "revoked") {
        portal.sessions[0]!.revokedAt = new Date();
      }
      if (scenario === "changed-browser") {
        headers = { "User-Agent": "Different browser" };
      }
      if (scenario === "inactive-admin") {
        portal.admin.active = false;
      }
      if (scenario === "blocked-user") {
        portal.user.status = "blocked";
      }
      if (scenario === "demoted-user") {
        portal.user.role = "member";
      }
      const response = await portal.request("/admin?tab=members", cookies, "192.0.2.10", { headers });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/admin/login");
    });
  }
});

test("admin forms reject missing CSRF and logout revokes the session", async (context) => {
  const portal = await createPortal(context);
  const { cookies, csrf } = await portal.signIn();
  const rejected = await portal.request("/admin/action", cookies, "192.0.2.10", { method: "POST" });
  assert.equal(rejected.status, 403);
  const logout = await portal.request("/admin/logout", cookies, "192.0.2.10", {
    method: "POST",
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.equal(logout.status, 302);
  assert.ok(portal.sessions[0]!.revokedAt);
  const response = await portal.request("/admin", cookies);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login");
});
