import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const payoutReminderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  cycle: { type: String, required: true },
  balanceKobo: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["pending", "sent", "skipped"], default: "pending" },
  nextAttemptAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

payoutReminderSchema.index({ userId: 1, cycle: 1 }, { unique: true });
payoutReminderSchema.index({ status: 1, nextAttemptAt: 1 });
payoutReminderSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PayoutReminder = InferSchemaType<typeof payoutReminderSchema>;
export const PayoutReminderModel = (models.PayoutReminder as Model<PayoutReminder>)
  || model<PayoutReminder>("PayoutReminder", payoutReminderSchema);
