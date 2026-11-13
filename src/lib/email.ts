import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { render } from "@react-email/render";

type EmailEnv = { RESEND_API_KEY?: string; STORE_EMAIL_FROM?: string };

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait before the next attempt: Resend's retry-after if given, else 500ms, 1s, 2s... */
function backoff(attempt: number, retryAfter: string | null) {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : 500 * 2 ** (attempt - 1);
  return Math.min(ms, MAX_WAIT_MS);
}

/**
 * Sends one email through Resend. Without RESEND_API_KEY (local development)
 * nothing is sent: the email is logged and counts as sent, so the order flow
 * and reminders can be tested end to end.
 *
 * `idempotencyKey` should name the event (e.g. "order-received/PF-1042"), so a
 * retried request, a double-submitted form or an overlapping cron run never
 * sends the same email twice. Resend keeps keys for 24 hours.
 *
 * Network errors, 429 and 5xx are retried with backoff; other 4xx are not.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
  idempotencyKey: string;
  replyTo?: string;
}): Promise<SendResult> {
  const { RESEND_API_KEY, STORE_EMAIL_FROM } = env as unknown as EmailEnv;
  const html = await render(opts.react);
  const textBody = await render(opts.react, { plainText: true });

  if (!RESEND_API_KEY) {
    console.log(`[email not sent: no RESEND_API_KEY] to=${opts.to} subject="${opts.subject}" key=${opts.idempotencyKey}`);
    return { ok: true, skipped: true };
  }

  const body = JSON.stringify({
    from: `Precise Formulations <${STORE_EMAIL_FROM}>`,
    to: [opts.to],
    subject: opts.subject,
    html,
    text: textBody,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
  });

  let error = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryAfter: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": opts.idempotencyKey,
        },
        body,
      });
      if (res.ok) {
        const { id } = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id };
      }
      const detail = await res.text();
      error = `Resend ${res.status}: ${detail}`;
      // 409 "concurrent_idempotent_requests" means the same email is still being sent: safe to retry.
      // Other 409s (same key, different payload) and 4xx won't succeed on retry.
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 409 && detail.includes("concurrent_idempotent_requests"));
      if (!retryable) break;
      retryAfter = res.headers.get("retry-after");
    } catch (err) {
      error = String(err); // network error: retry
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt, retryAfter));
  }

  console.error("Email failed", opts.to, opts.subject, error);
  return { ok: false, error };
}
