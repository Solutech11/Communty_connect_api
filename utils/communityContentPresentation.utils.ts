import type { Types } from "mongoose";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";

type ObjectIdLike = Types.ObjectId | string | { toString(): string };

type PopulatedUser = {
  _id: ObjectIdLike;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

type PopulatedAttachment = {
  _id: ObjectIdLike;
  url: string;
  type: "image" | "pdf" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailUrl?: string | null;
};

type PopulatedReply = {
  _id: ObjectIdLike;
  text: string;
  authorId?: PopulatedUser;
};

type CommunityContentView = {
  _id: ObjectIdLike;
  communityId: ObjectIdLike;
  authorId: PopulatedUser;
  kind: "post" | "announcement" | "message";
  text: string;
  imageUrl?: string;
  attachments?: PopulatedAttachment[];
  replyToId?: PopulatedReply;
  reactions?: Array<{ emoji: string; userIds: ObjectIdLike[] }>;
  clientMessageId?: string;
  pinnedAt?: Date;
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const asId = (value: ObjectIdLike): string => value.toString();

export const toCommunityAttachment = (attachment: PopulatedAttachment) => ({
  _id: asId(attachment._id),
  url: attachment.url,
  type: attachment.type,
  name: attachment.name,
  mimeType: attachment.mimeType,
  sizeBytes: attachment.sizeBytes,
  thumbnailUrl: attachment.thumbnailUrl || null,
});

const getRoles = async (communityId: string, authorIds: string[]): Promise<Map<string, string>> => {
  const members = await CommunityMemberModel.find({
    communityId,
    userId: { $in: authorIds },
  }).select("userId role").lean();
  return new Map(members.map((member) => [member.userId.toString(), member.role]));
};

export const presentCommunityContent = async (
  rawItems: CommunityContentView[],
  viewerId: string,
): Promise<Record<string, unknown>[]> => {
  if (rawItems.length === 0) return [];
  const communityId = asId(rawItems[0]!.communityId);
  const authorIds = [...new Set(rawItems.map((item) => asId(item.authorId._id)))];
  const roles = await getRoles(communityId, authorIds);

  return rawItems.map((item) => {
    const author = item.authorId;
    const base = {
      _id: asId(item._id),
      communityId: asId(item.communityId),
      author: {
        _id: asId(author._id),
        firstName: author.firstName || "",
        lastName: author.lastName || "",
        avatarUrl: author.avatarUrl || "",
        communityRole: roles.get(asId(author._id)) || "member",
      },
      text: item.text,
      imageUrl: item.imageUrl || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };

    if (item.kind !== "message") return base;

    const reply = item.replyToId;
    const replyAuthor = reply?.authorId;
    return {
      ...base,
      clientMessageId: item.clientMessageId || "",
      attachments: (item.attachments || []).map(toCommunityAttachment),
      replyTo: reply
        ? {
          _id: asId(reply._id),
          authorName: [replyAuthor?.firstName, replyAuthor?.lastName].filter(Boolean).join(" "),
          text: reply.text,
        }
        : null,
      reactions: (item.reactions || []).map((reaction) => ({
        emoji: reaction.emoji,
        count: reaction.userIds.length,
        reactedByViewer: reaction.userIds.some((userId) => asId(userId) === viewerId),
      })),
      pinnedAt: item.pinnedAt || null,
      editedAt: item.editedAt || null,
    };
  });
};
