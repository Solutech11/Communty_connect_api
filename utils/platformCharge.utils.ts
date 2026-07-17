import type { ClientSession } from "mongoose";
import { env } from "../Config/env";
import type { PlatformChargeType } from "../Constant";
import { PlatformEarningModel } from "../models/Admin/PlatformEarning.model";

const chargeRates: Record<PlatformChargeType, number> = {
  deposit: env.DEPOSIT_CHARGE_BPS,
  withdrawal: env.WITHDRAWAL_CHARGE_BPS,
  ticket_purchase: env.TICKET_CHARGE_BPS,
  community_membership: env.COMMUNITY_CHARGE_BPS,
};

export const calculatePlatformCharge = (
  amountKobo: number,
  chargeType: PlatformChargeType,
): number => {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
    throw new TypeError("Charge amount must be a non-negative integer in kobo");
  }

  if (amountKobo === 0 || chargeRates[chargeType] === 0) {
    return 0;
  }

  return Math.min(amountKobo, Math.ceil((amountKobo * chargeRates[chargeType]) / 10_000));
};

export const recordPlatformEarning = async (input: {
  sourceType: PlatformChargeType;
  sourceReference: string;
  payerUserId: unknown;
  beneficiaryUserId?: unknown;
  transactionId: unknown;
  grossAmountKobo: number;
  feeAmountKobo: number;
  netAmountKobo: number;
  metadata?: Record<string, unknown>;
  session: ClientSession;
}): Promise<void> => {
  if (input.feeAmountKobo === 0) {
    return;
  }

  await PlatformEarningModel.updateOne(
    { sourceType: input.sourceType, sourceReference: input.sourceReference },
    {
      $setOnInsert: {
        payerUserId: input.payerUserId,
        beneficiaryUserId: input.beneficiaryUserId,
        transactionId: input.transactionId,
        grossAmountKobo: input.grossAmountKobo,
        feeAmountKobo: input.feeAmountKobo,
        netAmountKobo: input.netAmountKobo,
        currency: env.PAYSTACK_CURRENCY,
        status: "earned",
        metadata: input.metadata || {},
        earnedAt: new Date(),
      },
    },
    { upsert: true, session: input.session },
  );
};
