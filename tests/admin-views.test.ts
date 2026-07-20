import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ejs = require("ejs") as {
  compile: (template: string) => (data: Record<string, unknown>) => string;
};

test("admin EJS login and dashboard templates render escaped operational data", () => {
  const login = ejs.compile(fs.readFileSync(path.resolve("views/admin/login.ejs"), "utf8"));
  const dashboard = ejs.compile(fs.readFileSync(path.resolve("views/admin/dashboard.ejs"), "utf8"));

  const loginHtml = login({
    title: "Admin sign in",
    csrfToken: "csrf-token",
    error: undefined,
  });
  assert.match(loginHtml, /Admin sign in/);
  assert.match(loginHtml, /csrf-token/);

  const dashboardHtml = dashboard({
    title: "Dashboard",
    csrfToken: "csrf-token",
    permissions: ["users:moderate", "admins:manage"],
    users: [{
      _id: "user",
      firstName: "<Admin>",
      lastName: "User",
      email: "admin@example.com",
      role: "admin",
      status: "active",
      createdAt: new Date(),
    }],
    events: [],
    admins: [],
    recentEarnings: [],
    earningBreakdown: [],
    stats: {
      userCount: 1,
      suspendedUserCount: 0,
      pendingEventCount: 0,
      publishedEventCount: 0,
      totalEarningsKobo: 0,
    },
    message: "",
    formatNaira: (kobo: number) => `NGN ${(kobo / 100).toFixed(2)}`,
  });

  assert.match(dashboardHtml, /Operations centre/);
  assert.match(dashboardHtml, /Add administrator/);
  assert.match(dashboardHtml, /Block member/);
  assert.match(dashboardHtml, /&lt;Admin&gt;/);
  assert.doesNotMatch(dashboardHtml, /<Admin>/);
});
