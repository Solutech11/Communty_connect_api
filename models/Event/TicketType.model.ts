import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ticketTypeSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 300 },
    priceKobo: { type: Number, required: true, min: 0 },
    capacity: { type: Number, min: 1 },
    sold: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0, select: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

ticketTypeSchema.index({ eventId: 1, title: 1 }, { unique: true });

export type TicketType = InferSchemaType<typeof ticketTypeSchema>;
export const TicketTypeModel = (models.TicketType as Model<TicketType>) || model<TicketType>("TicketType", ticketTypeSchema);

