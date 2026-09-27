import { createHmac } from "node:crypto";
import { env } from "../Config/env";

// A keyed lookup keeps short access codes out of a reversible database index.
export const communityCodeLookupHash = (code: string): string => createHmac(
  "sha256",
  Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex"),
).update(`community-access-code:${code.trim()}`).digest("hex");
