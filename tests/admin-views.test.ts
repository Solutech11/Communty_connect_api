import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ejs = require("ejs") as {
  compile: (template: string, options?: { filename?: string }) => (data: Record<string, unknown>) => string;
};

test("admin EJS login and dashboard templates render escaped operational data", () => {
  const login = ejs.compile(fs.readFileSync(path.resolve("views/admin/login.ejs"), "utf8"));
  const dashboardPath = path.resolve("views/admin/dashboard.ejs");
  const dashboard = ejs.compile(fs.readFileSync(dashboardPath, "utf8"), { filename: dashboardPath });

  const loginHtml = login({
    title: "Admin sign in",
    csrfToken: "csrf-token",
    error: undefined,
  });
  assert.match(loginHtml, /Admin sign in/);
  assert.match(loginHtml, /csrf-token/);
  assert.match(loginHtml, /community-connect-mark\.svg/);

  const dashboardHtml = dashboard({
    title: "Dashboard",
    csrfToken: "csrf-token",
    permissions: [
      "users:read",
      "users:moderate",
      "admins:manage",
      "events:moderate",
      "communities:moderate",
      "reports:moderate",
      "earnings:read",
    ],
    users: [{
      _id: "user",
      firstName: "<Admin>",
      lastName: "User",
      email: "admin@example.com",
      role: "user",
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

  assert.match(dashboardHtml, /Community Connect/);
  assert.match(dashboardHtml, /Operations overview/);
  assert.match(dashboardHtml, /community-connect-mark\.svg/);
  assert.match(dashboardHtml, /href="\/admin\/events"/);
  assert.match(dashboardHtml, /href="\/admin\?tab=members"/);
  assert.match(dashboardHtml, /Add administrator/);
  assert.match(dashboardHtml, /Block member/);
  assert.match(dashboardHtml, /&lt;Admin&gt;/);
  assert.doesNotMatch(dashboardHtml, /<Admin>/);
});
