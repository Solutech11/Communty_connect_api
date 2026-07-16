import { Schema, model, models, type HydratedDocument, type Model } from "mongoose";
import { USER_ROLES, type UserRole } from "../../Constant";

export interface User {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: UserRole;
  status: "pending_verification" | "active" | "suspended" | "deleted";
  emailVerifiedAt?: Date;
  avatarUrl?: string;
  bio?: string;
  country: string;
  state?: string;
  lga?: string;
  location?: { type: "Point"; coordinates: [number, number] };
  interests: string[];
  expoPushTokens: string[];
  tokenVersion: number;
  lastLoginAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    phone: { type: String, trim: true, maxlength: 24 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: "member", index: true },
    status: {
      type: String,
      enum: ["pending_verification", "active", "suspended", "deleted"],
      default: "pending_verification",
      index: true,
    },
    emailVerifiedAt: { type: Date },
    avatarUrl: { type: String },
    bio: { type: String, maxlength: 500 },
    country: { type: String, default: "Nigeria" },
    state: { type: String },
    lga: { type: String },
    // GeoJSON Point coordinates are stored as [longitude, latitude].
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined },
    },
    interests: [{ type: String, trim: true, maxlength: 40 }],
    expoPushTokens: [{ type: String, select: false }],
    tokenVersion: { type: Number, default: 0, select: true },
    lastLoginAt: { type: Date },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_document, result) => {
        const safeResult = result as unknown as Record<string, unknown>;
        delete safeResult.passwordHash;
        delete safeResult.expoPushTokens;
        delete safeResult.tokenVersion;
        return result;
      },
    },
  },
);

userSchema.index({ firstName: "text", lastName: "text", email: "text" });
// Required by $geoNear when ordering events around a saved user location.
userSchema.index({ location: "2dsphere" });

export type UserDocument = HydratedDocument<User>;
export const UserModel = (models.User as Model<User>) || model<User>("User", userSchema);
