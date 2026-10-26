import type { RequestHandler } from "express";
import {
  recordUserActivity,
  type UserActivityCategory,
} from "../utils/userActivity.utils";

type ActivityDescription = {
  category: UserActivityCategory;
  title: string;
  body: string;
};

const describeActivity = (method: string, path: string): ActivityDescription | undefined => {
  const normalizedPath = path.replace(/^\/api\/v\d+(?=\/|$)/i, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  const domain = segments[0]?.toLowerCase();
  const action = segments.slice(1).join("/").toLowerCase();
  const isDelete = method === "DELETE";

  // Device-token changes happen automatically, and account deletion removes access to this history.
  // Keep both out of the activity feed.
  if (
    domain === "users"
    && ((action === "me" && isDelete) || action.startsWith("me/push-tokens"))
  ) {
    return undefined;
  }
  if (domain === "communities" && action === "resolve-code") return undefined;

  switch (domain) {
    case "users":
      if (action.endsWith("/reports")) {
        return {
          category: "account",
          title: "Member report submitted",
          body: "You submitted a report about a member.",
        };
      }
      if (action === "me/password") {
        return {
          category: "account",
          title: "Password changed",
          body: "The password for your account was updated.",
        };
      }
      if (action.includes("/blocks/") || action.startsWith("me/blocks/")) {
        return {
          category: "account",
          title: isDelete ? "Member unblocked" : "Member blocked",
          body: isDelete
            ? "You removed a member from your block list."
            : "You added a member to your block list.",
        };
      }
      return {
        category: "account",
        title: "Profile updated",
        body: "You saved a change to your account profile.",
      };
    case "communities":
      if (action.includes("membership-orders")) {
        return {
          category: "communities",
          title: "Membership order started",
          body: "You started a community membership order. Payment details are not stored here.",
        };
      }
      if (action.endsWith("/reports") || action.includes("/reports/")) {
        return {
          category: "communities",
          title: "Community report submitted",
          body: "You submitted a report about community content.",
        };
      }
      if (action.includes("posts")) {
        return {
          category: "communities",
          title:
            method === "POST"
              ? "Community post published"
              : isDelete
                ? "Community post removed"
                : "Community post updated",
          body: "Your community post activity was saved.",
        };
      }
      if (action.includes("announcements")) {
        return {
          category: "communities",
          title:
            method === "POST"
              ? "Announcement published"
              : isDelete
                ? "Announcement removed"
                : "Announcement updated",
          body: "Your community announcement activity was saved.",
        };
      }
      if (action.includes("join-requests")) {
        return {
          category: "communities",
          title:
            method === "POST"
              ? "Community request sent"
              : isDelete
                ? "Community request withdrawn"
                : "Community request reviewed",
          body: "Your community join request activity was saved.",
        };
      }
      if (action.endsWith("messages/read")) return undefined;
      if (action.includes("messages") && action.includes("reports")) {
        return {
          category: "communities",
          title: "Chat report submitted",
          body: "You submitted a report about a community message.",
        };
      }
      if (action.includes("messages")) {
        const messageTitle = action.includes("reactions")
          ? "Message reaction updated"
          : action.includes("pin")
            ? isDelete
              ? "Message unpinned"
              : "Message pinned"
            : method === "POST"
              ? "Community message sent"
              : isDelete
                ? "Community message removed"
                : "Community message updated";
        return {
          category: "communities",
          title: messageTitle,
          body: "Your community message activity was saved. Message contents are not stored here.",
        };
      }
      if (action.endsWith("members") || action.includes("members/me")) {
        return {
          category: "communities",
          title: isDelete ? "Left a community" : "Joined a community",
          body: isDelete ? "You left a community." : "You joined a community.",
        };
      }
      if (action.includes("calls")) {
        return {
          category: "communities",
          title: action.includes("join")
            ? "Joined a community call"
            : isDelete
              ? "Community call ended"
              : "Community call started",
          body: "Your community call activity was saved.",
        };
      }
      return {
        category: "communities",
        title: segments.length === 1 ? "Community created" : "Community updated",
        body: "Your community changes were saved.",
      };
    case "events":
      if (action.includes("cancel")) {
        return {
          category: "events",
          title: "Event cancelled",
          body: "You cancelled an event.",
        };
      }
      if (action.includes("publish")) {
        return {
          category: "events",
          title: "Event submitted",
          body: "Your event was submitted for review.",
        };
      }
      if (action.includes("orders")) {
        return {
          category: "events",
          title: "Ticket order started",
          body: "Your event ticket order was started. Payment details are not stored here.",
        };
      }
      if (action.includes("ticket-types")) {
        return {
          category: "events",
          title: "Event ticket options updated",
          body: "You updated the ticket options for an event.",
        };
      }
      if (action.includes("check-ins")) {
        return {
          category: "events",
          title: "Ticket check-in completed",
          body: "A ticket was checked in for your event.",
        };
      }
      if (action.endsWith("/reports")) {
        return {
          category: "events",
          title: "Event report submitted",
          body: "You submitted a report about an event.",
        };
      }
      if (action.includes("register") || action.includes("attend")) {
        return {
          category: "events",
          title: "Event participation updated",
          body: "Your event participation activity was saved.",
        };
      }
      return {
        category: "events",
        title: segments.length === 1
          ? "Event created"
          : isDelete
            ? "Event removed"
            : "Event updated",
        body: "Your event changes were saved.",
      };
    case "friends":
      return {
        category: "friends",
        title:
          method === "POST"
            ? "Friend request sent"
            : isDelete
              ? "Friend removed"
              : "Friend request updated",
        body: "Your friend connection activity was saved.",
      };
    case "roommates":
      return {
        category: "roommates",
        title: action.includes("profile")
          ? "Roommate profile updated"
          : action.includes("request")
            ? "Roommate request updated"
            : "Roommate connection updated",
        body: "Your roommate activity was saved.",
      };
    case "ai":
      return {
        category: "chat",
        title: "Community AI used",
        body: "You used Community AI. Your prompt and response are not included in this activity log.",
      };
    case "chat":
      if (action.includes("reports")) {
        return {
          category: "chat",
          title: "Chat report submitted",
          body: "You submitted a report about a chat message.",
        };
      }
      return {
        category: "chat",
        title: action.endsWith("messages") ? "Message sent" : "Chat activity",
        body: action.endsWith("messages")
          ? "You sent a message. Message contents are not stored in this activity log."
          : "Your chat activity was saved.",
      };
    case "tickets":
      return {
        category: "tickets",
        title: "Ticket activity",
        body: "A ticket action on your account was completed.",
      };
    case "wallet":
      return {
        category: "wallet",
        title: "Wallet activity",
        body: "A wallet action was completed. Payment and account details are not stored here.",
      };
    case "disputes":
      return {
        category: "support",
        title: "Support request updated",
        body: "Your support request activity was saved.",
      };
    default:
      return undefined;
  }
};

/** Records successful signed-in write actions without retaining request data. */
export const userActivityAudit: RequestHandler = (request, response, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    next();
    return;
  }

  response.once("finish", () => {
    const userId = request.auth?.id;
    if (!userId || response.statusCode < 200 || response.statusCode >= 300) return;

    const pathname = ((request.originalUrl || request.url) ?? "").split("?")[0] ?? "";
    const activity = describeActivity(request.method, pathname);
    if (!activity) return;

    void recordUserActivity({ userId, ...activity });
  });

  next();
};
