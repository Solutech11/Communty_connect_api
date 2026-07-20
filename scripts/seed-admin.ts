import bcrypt from "bcrypt";
import { env } from "../Config/env";
import { connectMongo, disconnectMongo } from "../DB/mongo";
import { RefreshTokenModel } from "../models/Auth/RefreshToken.model";
import { UserModel } from "../models/Auth/User.model";
import { WalletModel } from "../models/Wallet/Wallet.model";

const buildWalletNumber = (): string => {
  const random = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return "CC" + random;
};

const requireSeedInput = (): { email: string; password: string } => {
  const email = 'admin@admin.com';
  const password = 'Test123$$';

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }

  if (!password) {
    throw new Error("ADMIN_PASSWORD is required");
  }

  return { email, password };
};

const allocateWalletNumber = async (): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const walletNumber = buildWalletNumber();
    if (!(await WalletModel.exists({ walletNumber }))) {
      return walletNumber;
    }
  }

  throw new Error("Could not allocate a unique wallet number");
};

const seedAdmin = async (): Promise<void> => {
  const { email, password } = requireSeedInput();
  await connectMongo();

  try {
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    let user = await UserModel.findOne({ email }).select("+passwordHash");

    if (user) {
      user.passwordHash = passwordHash;
      user.role = "admin";
      user.status = "active";
      user.emailVerifiedAt ??= new Date();
      user.tokenVersion += 1;
      await user.save();
      await RefreshTokenModel.updateMany(
        { userId: user._id, revokedAt: { $exists: false } },
        { revokedAt: new Date() },
      );
    } else {
      user = await UserModel.create({
        firstName: "Admin",
        lastName: "User",
        email,
        passwordHash,
        role: "admin",
        status: "active",
        emailVerifiedAt: new Date(),
      });
    }

    if (!(await WalletModel.exists({ userId: user._id }))) {
      await WalletModel.create({
        userId: user._id,
        walletNumber: await allocateWalletNumber(),
        currency: env.PAYSTACK_CURRENCY,
      });
    }

    process.stdout.write("Admin account seeded successfully.\n");
  } finally {
    await disconnectMongo();
  }
};

void seedAdmin().catch((error) => {
  const message = error instanceof Error ? error.message : "Admin seed failed";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
