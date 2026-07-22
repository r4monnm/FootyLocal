export type VerificationFlags = {
  phone_verified: boolean;
  photo_verified: boolean;
  id_verified: boolean;
};

export type VerificationBadge = "phone" | "photo" | "id";
export type VerificationLevel = "none" | VerificationBadge;

/** Ordered badges a profile has earned + the highest level reached.
 * Order is phone → photo → id; level is the highest true flag (id > photo > phone). */
export function verificationSummary(
  flags: VerificationFlags,
): { level: VerificationLevel; badges: VerificationBadge[] } {
  const badges: VerificationBadge[] = [];
  if (flags.phone_verified) badges.push("phone");
  if (flags.photo_verified) badges.push("photo");
  if (flags.id_verified) badges.push("id");

  const level: VerificationLevel = flags.id_verified
    ? "id"
    : flags.photo_verified
      ? "photo"
      : flags.phone_verified
        ? "phone"
        : "none";

  return { level, badges };
}
