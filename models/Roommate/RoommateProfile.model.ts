import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { roommateOptions } from "../../schemas/roommate.schemas";

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  visibility: { type: String, enum: ["draft", "discoverable", "paused", "paired"], default: "draft", required: true },
  questionnaireVersion: { type: Number, default: 1 },
  revision: { type: Number, default: 0 },
  activeConnectionId: { type: Schema.Types.ObjectId, ref: "RoommateConnection" },
  adultConfirmed: { type: Boolean },
  housingMode: { type: String, enum: roommateOptions.housingMode },
  state: { type: String, trim: true, maxlength: 100 },
  lgas: { type: [String], default: undefined },
  minAnnualRentKobo: { type: Number, min: 0 },
  maxAnnualRentKobo: { type: Number, min: 1 },
  moveInFrom: { type: String },
  moveInTo: { type: String },
  gender: { type: String, enum: roommateOptions.gender },
  acceptableGenders: { type: [String], default: undefined },
  cleanliness: { type: String, enum: roommateOptions.cleanliness },
  sleepSchedule: { type: String, enum: roommateOptions.sleepSchedule },
  guests: { type: String, enum: roommateOptions.guests },
  socialPreference: { type: String, enum: roommateOptions.socialPreference },
  smokes: { type: Boolean },
  acceptsSmoking: { type: Boolean },
  hasPets: { type: Boolean },
  acceptsPets: { type: Boolean },
  description: { type: String, maxlength: 500 },
}, { timestamps: true, versionKey: false });
schema.index({ visibility: 1, state: 1, lgas: 1 });
schema.index({ activeConnectionId: 1 });
export type RoommateProfile = InferSchemaType<typeof schema>;
export const RoommateProfileModel = (models.RoommateProfile as Model<RoommateProfile>)
  || model("RoommateProfile", schema);
