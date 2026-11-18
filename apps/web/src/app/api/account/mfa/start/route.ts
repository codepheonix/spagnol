import QRCode from "qrcode";
import { mfaEnabled, passwordChangeOwed, startTotpEnrollment } from "@sm/core";
import { apiSession, handle, json, HttpError } from "@/lib/api";

/**
 * Begins two-factor set-up: a new secret, shown once as a QR code and as text. Nothing changes on
 * the account until the first code is confirmed. Refused while the password still has to be changed.
 */
export const POST = handle(async () => {
  const { user } = await apiSession({ gate: false });
  if (passwordChangeOwed(user)) throw new HttpError(403, "Change your password first.", "password_change_required");
  if (mfaEnabled(user)) throw new HttpError(409, "Two-factor sign-in is already on.", "mfa_enabled");
  const { secret, otpauthUrl } = await startTotpEnrollment(user.id);
  const qrSvg = await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return json({ secret, qrSvg }, { headers: { "cache-control": "no-store" } });
});
