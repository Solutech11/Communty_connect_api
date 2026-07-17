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
      admin?: {
        adminId: string;
        userId: string;
        sessionId: string;
        csrfToken: string;
        permissions: string[];
      };
      requestId: string;
      rawBody?: Buffer;
      idempotencyKey?: string;
    }
  }
}

export {};
