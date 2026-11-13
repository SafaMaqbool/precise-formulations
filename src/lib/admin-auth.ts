import { env } from "cloudflare:workers";

/**
 * The admin portal is protected by Cloudflare Access (Zero Trust). Access signs in the
 * client before a request reaches the site and attaches a signed token. We check that
 * token here too, so the admin can't be reached by skipping Access (for example through
 * the workers.dev address).
 *
 * Setup at launch: create an Access application for /admin* and /api/admin*, then set
 * ACCESS_TEAM_DOMAIN (e.g. "precise.cloudflareaccess.com") and ACCESS_AUD (the
 * application's "Application Audience (AUD) Tag") in wrangler.jsonc.
 *
 * In local development (`bun run dev`) the check is skipped.
 */

type AccessEnv = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

export type AdminAuth = { ok: true; email: string } | { ok: false; reason: string };

export async function checkAdminAccess(request: Request): Promise<AdminAuth> {
  if (import.meta.env.DEV) return { ok: true, email: "local-dev" };

  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = env as unknown as AccessEnv;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD || ACCESS_AUD.startsWith("replace-with")) {
    // Fail closed: no admin until Access is configured
    return { ok: false, reason: "Admin access isn't set up yet (Cloudflare Access)." };
  }

  const token = request.headers.get("cf-access-jwt-assertion") ?? readCookie(request, "CF_Authorization");
  if (!token) return { ok: false, reason: "Please sign in through Cloudflare Access." };

  try {
    const payload = await verifyAccessJwt(token, ACCESS_TEAM_DOMAIN, ACCESS_AUD);
    return { ok: true, email: String(payload.email ?? "admin") };
  } catch (err) {
    console.error("Admin access denied", err);
    return { ok: false, reason: "Your sign-in couldn't be verified. Please sign in again." };
  }
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const b64urlToBytes = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlToJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// Access signing keys, cached per Worker instance for an hour
let certs: { keys: (JsonWebKey & { kid: string })[]; fetchedAt: number; team: string } | undefined;

async function getCerts(team: string, force = false) {
  if (!force && certs && certs.team === team && Date.now() - certs.fetchedAt < 3_600_000) return certs.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs request failed: ${res.status}`);
  const data = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  certs = { keys: data.keys, fetchedAt: Date.now(), team };
  return data.keys;
}

async function verifyAccessJwt(token: string, team: string, aud: string) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("Malformed token");
  const header = b64urlToJson(h) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new Error("Unexpected algorithm");

  let jwk = (await getCerts(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getCerts(team, true)).find((k) => k.kid === header.kid); // keys rotate
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new Error("Bad signature");

  const payload = b64urlToJson(p) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("Wrong audience");
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("Token expired");
  if (payload.iss !== `https://${team}`) throw new Error("Wrong issuer");
  return payload;
}
