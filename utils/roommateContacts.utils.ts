import { sha256, secureEqual } from "./crypto.utils";

export interface ContactUser { _id: { toString(): string }; phone?: string; email: string }
export interface ContactConsent { userId: { toString(): string }; fields: string[]; contactFingerprint: string }

export const contactFingerprint = (user: { phone?: string; email: string }, fields: string[]): string =>
  sha256(JSON.stringify([...fields].sort().map((field) => [field, field === "phone" ? user.phone : user.email])));

export const contactExchangeAllowed = (users: ContactUser[], consents: ContactConsent[]): boolean =>
  users.length === 2 && users.every((user) => {
    const consent = consents.find((item) => item.userId.toString() === user._id.toString());
    return Boolean(consent && consent.fields.length
      && secureEqual(consent.contactFingerprint, contactFingerprint(user, consent.fields)));
  });
