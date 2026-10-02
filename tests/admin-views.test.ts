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

test("admin reports and community workspaces render app-submitted records", () => {
  const csrfToken = "csrf-token-for-admin-forms";
  const permissions = ["communities:moderate", "reports:moderate"];
  const reportsPath = path.resolve("views/admin/reports.ejs");
  const communityPath = path.resolve("views/admin/community-detail.ejs");
  const reports = ejs.compile(fs.readFileSync(reportsPath, "utf8"), { filename: reportsPath });
  const communityDetails = ejs.compile(fs.readFileSync(communityPath, "utf8"), { filename: communityPath });
  const now = new Date("2026-10-01T12:00:00.000Z");
  const formatNaira = (kobo: number) => `NGN ${(kobo / 100).toFixed(2)}`;

  const reportsHtml = reports({
    title: "Reports and app issues",
    csrfToken,
    permissions,
    activeTab: "reports",
    message: "",
    reportCounts: { open: 1 },
    reportStatus: "all",
    reportTargetType: "all",
    reportTotal: 1,
    reportPage: 1,
    reportPageCount: 1,
    reports: [{
      _id: "report-1",
      status: "open",
      targetType: "community_message",
      reason: "harassment",
      createdAt: now,
      reporterId: { _id: "reporter-1", firstName: "Amina", lastName: "Reporter" },
      target: {
        _id: "message-1",
        kind: "message",
        text: "Please review this message",
        communityId: { _id: "community-1", name: "Lagos Creators" },
        authorId: { firstName: "Kunle", lastName: "Member" },
        attachments: [],
      },
    }],
    disputes: [{
      _id: "dispute-1",
      status: "open",
      disputeNumber: "DSP-123",
      category: "payment",
      priority: "high",
      createdAt: now,
      subject: "Ticket payment missing",
      description: "My ticket payment is not showing in the app.",
      userId: { firstName: "Ada", lastName: "Member", email: "ada@example.com", status: "active" },
      transactionId: {
        title: "Event ticket",
        reference: "PAY-123",
        type: "ticket_purchase",
        direction: "debit",
        amountKobo: 250000,
        feeKobo: 2500,
        currency: "NGN",
        status: "completed",
        completedAt: now,
      },
      assignedTo: null,
      resolution: "",
      resolvedAt: null,
      messages: [{
        authorId: { firstName: "Siva", role: "admin" },
        internal: true,
        message: "Check the provider settlement reference.",
        createdAt: now,
        attachments: [],
      }],
    }],
    disputeCounts: { open: 1 },
    disputeStatus: "all",
    disputePage: 1,
    disputePageCount: 1,
    disputeTotal: 1,
    formatNaira,
  });

  assert.match(reportsHtml, /App content reports/);
  assert.match(reportsHtml, /Lagos Creators/);
  assert.match(reportsHtml, /App issue disputes/);
  assert.match(reportsHtml, /PAY-123/);
  assert.match(reportsHtml, /Private admin note/);
  assert.match(reportsHtml, /\/admin\/disputes\/dispute-1\/messages/);
  assert.match(reportsHtml, new RegExp(csrfToken));

  const communityHtml = communityDetails({
    title: "Lagos Creators · Community details",
    csrfToken,
    permissions,
    activeTab: "communities",
    message: "",
    community: {
      _id: "community-1",
      name: "Lagos Creators",
      slug: "lagos-creators",
      description: "A home for creators in Lagos.",
      category: "Arts",
      visibility: "public",
      membershipType: "premium",
      membershipPriceKobo: 100000,
      joinPolicy: "approval",
      messagePermission: "everyone",
      membersCanCreatePosts: true,
      membersCanInvite: false,
      showMemberList: true,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      ownerId: { firstName: "Tola", lastName: "Owner", email: "owner@example.com" },
      isActive: true,
      rules: [{ title: "Be respectful", description: "Treat members with respect." }],
      consequences: ["Content removal"],
      rulesIntroduction: "Community guidelines",
      rulesUpdatedAt: null,
      rulesUpdatedBy: null,
      adminActivatedAt: null,
      adminActivatedBy: null,
      adminDeactivationReason: "",
      adminDeactivatedAt: null,
      adminDeactivatedBy: null,
    },
    members: [{
      userId: { firstName: "Ada", lastName: "Member", email: "ada@example.com", status: "active" },
      role: "member",
      status: "active",
      joinedAt: now,
      muted: false,
      notificationLevel: "all",
    }],
    memberCount: 1,
    memberStats: { active: 1, pending: 0 },
    memberPage: 1,
    memberPageCount: 1,
    orders: [{
      orderNumber: "CO-123",
      buyerId: { firstName: "Ada", lastName: "Member", email: "ada@example.com" },
      grossAmountKobo: 100000,
      platformFeeKobo: 5000,
      ownerProceedsKobo: 95000,
      status: "paid",
      createdAt: now,
      paidAt: now,
    }],
    orderCount: 1,
    paidOrderCount: 1,
    orderStatusCounts: { paid: 1 },
    orderPage: 1,
    orderPageCount: 1,
    joinRequests: [{
      requesterId: { firstName: "Chidi", lastName: "Applicant", email: "chidi@example.com" },
      reviewedBy: null,
      status: "pending",
      message: "I would like to join.",
      reviewNote: "",
      createdAt: now,
    }],
    joinRequestCounts: { pending: 1 },
    content: [{
      authorId: { firstName: "Ada", lastName: "Member" },
      kind: "post",
      text: "Our first meetup is next week.",
      createdAt: now,
      attachments: [{ url: "https://cdn.example.com/agenda.pdf", name: "agenda.pdf", type: "document", sizeBytes: 2048 }],
      imageUrl: "",
      pinnedAt: null,
      deletedAt: null,
      editedAt: null,
      replyToId: null,
    }],
    contentCount: 1,
    contentPage: 1,
    contentPageCount: 1,
    formatNaira,
  });

  assert.match(communityHtml, /Access and settings/);
  assert.match(communityHtml, /Be respectful/);
  assert.match(communityHtml, /Chidi/);
  assert.match(communityHtml, /CO-123/);
  assert.match(communityHtml, /NGN 1000\.00/);
  assert.match(communityHtml, /agenda\.pdf/);
  assert.match(communityHtml, /Deactivate community/);
  assert.match(communityHtml, new RegExp(csrfToken));
});
