import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { render } from "@react-email/render";

type EmailEnv = { RESEND_API_KEY?: string; STORE_EMAIL_FROM?: string };

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Sends one email through Resend. Without RESEND_API_KEY (local development)
 * nothing is sent: the email is logged and counts as sent, so the order flow
 * and reminders can be tested end to end.
 */
export async function sendEmail(opts: { to: string; subject: string; react: ReactElement; replyTo?: string }): Promise<SendResult> {
  const { RESEND_API_KEY, STORE_EMAIL_FROM } = env as unknown as EmailEnv;
  const html = await render(opts.react);
  const textBody = await render(opts.react, { plainText: true });

  if (!RESEND_API_KEY) {
    console.log(`[email not sent: no RESEND_API_KEY] to=${opts.to} subject="${opts.subject}"`);
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Precise Formulations <${STORE_EMAIL_FROM}>`,
        to: [opts.to],
        subject: opts.subject,
        html,
        text: textBody,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const error = `Resend ${res.status}: ${await res.text()}`;
      console.error("Email failed", opts.to, opts.subject, error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    console.error("Email failed", opts.to, opts.subject, err);
    return { ok: false, error: String(err) };
  }
}
