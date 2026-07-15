import type { UserRole } from "../Constant";

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      email: string;
      role: UserRole;
      tokenVersion: number;
    }

    interface Request {
      auth?: AuthenticatedUser;
      requestId: string;
      rawBody?: Buffer;
      idempotencyKey?: string;
    }
  }
}

export {};
