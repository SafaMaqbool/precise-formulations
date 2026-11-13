import { env } from "cloudflare:workers";

/**
 * Spam protection for checkout with Cloudflare Turnstile.
 *
 * The browser gets a one-time token from the Turnstile widget and sends it with the order.
 * Tokens can only be checked once, but checkout can take two requests (the address check,
 * then "Use suggested" / "Keep mine"). So after a token passes, we hand back a short-lived
 * signed ticket that the second request can use instead.
 *
 * Locally, .dev.vars uses Cloudflare's test keys (always pass). In production, set the real
 * TURNSTILE_SITE_KEY (wrangler.jsonc) and TURNSTILE_SECRET_KEY (`wrangler secret put`).
 * Until a secret key is set, the check is skipped and a warning is logged.
 */

type TurnstileEnv = { TURNSTILE_SECRET_KEY?: string; TURNSTILE_SITE_KEY?: string };
const cfg = () => env as unknown as TurnstileEnv;

const TICKET_TTL_MS = 10 * 60_000;

/** Site key for the widget, or null when Turnstile isn't set up */
export function turnstileSiteKey() {
  const key = cfg().TURNSTILE_SITE_KEY;
  return key && !key.startsWith("replace-with") ? key : null;
}

export type HumanCheck = { ok: true; ticket?: string } | { ok: false; message: string };

export async function verifyHuman(opts: { token?: unknown; ticket?: unknown; email: string; ip: string | null }): Promise<HumanCheck> {
  const secret = cfg().TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!import.meta.env.DEV) console.warn("TURNSTILE_SECRET_KEY is not set: checkout spam protection is off");
    return { ok: true };
  }

  if (typeof opts.ticket === "string" && opts.ticket && (await checkTicket(opts.ticket, opts.email, secret))) {
    return { ok: true };
  }

  if (typeof opts.token !== "string" || !opts.token) {
    return { ok: false, message: "Please wait for the security check to finish, then try again." };
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: opts.token, ...(opts.ip ? { remoteip: opts.ip } : {}) }),
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) {
      console.warn("Turnstile rejected", data["error-codes"]);
      return { ok: false, message: "The security check didn't pass. Please try again." };
    }
    return { ok: true, ticket: await makeTicket(opts.email, secret) };
  } catch (err) {
    // If Cloudflare can't be reached, don't lose a real customer's order
    console.error("Turnstile verification failed", err);
    return { ok: true };
  }
}

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`checkout-ticket:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Ticket = expiry + signature over (expiry, email), so it only works for this customer, briefly
async function makeTicket(email: string, secret: string) {
  const exp = String(Date.now() + TICKET_TTL_MS);
  return `${exp}.${await hmac(`${exp}|${email.toLowerCase()}`, secret)}`;
}

async function checkTicket(ticket: string, email: string, secret: string) {
  const [exp, sig] = ticket.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await hmac(`${exp}|${email.toLowerCase()}`, secret)) === sig;
}
