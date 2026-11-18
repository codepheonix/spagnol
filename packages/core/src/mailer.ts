/**
 * Outgoing e-mail. No paid mail service is assumed: with `MAIL_PROVIDER` unset nothing is sent and
 * the caller is told so (the reset flow then relies on the documented owner recovery procedure).
 * `MAIL_PROVIDER=test` keeps messages in memory for automated tests.
 */
export interface MailMessage { to: string; subject: string; text: string }
const outbox: MailMessage[] = [];

export function mailConfigured(): boolean {
  return (process.env.MAIL_PROVIDER ?? "none") !== "none";
}

export async function sendMail(msg: MailMessage): Promise<{ sent: boolean; reason?: string }> {
  const provider = process.env.MAIL_PROVIDER ?? "none";
  if (provider === "test") {
    outbox.push(msg);
    return { sent: true };
  }
  return { sent: false, reason: "no mail provider is configured" };
}

/** Test helper: messages "sent" with MAIL_PROVIDER=test. */
export function testOutbox(): MailMessage[] {
  return outbox;
}
