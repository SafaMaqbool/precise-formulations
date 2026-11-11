import { env } from "cloudflare:workers";

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export type VerifyResult =
  | { status: "ok"; address: Address } // matches USPS exactly
  | { status: "suggest"; address: Address } // USPS has a corrected version
  | { status: "invalid" } // USPS couldn't find it
  | { status: "unavailable" }; // no credentials, API down or rate limited: don't block the order

type AddressEnv = { USPS_CLIENT_ID?: string; USPS_CLIENT_SECRET?: string };

const norm = (s = "") => s.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

export function sameAddress(a: Address, b: Address) {
  return (
    norm(a.addressLine1) === norm(b.addressLine1) &&
    norm(a.addressLine2) === norm(b.addressLine2) &&
    norm(a.city) === norm(b.city) &&
    norm(a.state) === norm(b.state) &&
    norm(a.zip).slice(0, 5) === norm(b.zip).slice(0, 5)
  );
}

/**
 * Checks an address before the order is saved.
 * PENDING: Owais to confirm which service the current site uses. This targets the
 * USPS Addresses API v3; check the request and response fields against the USPS
 * docs once we have credentials. Without credentials it uses a local mock in dev
 * and skips the check in production.
 */
export async function verifyAddress(input: Address): Promise<VerifyResult> {
  const { USPS_CLIENT_ID, USPS_CLIENT_SECRET } = env as unknown as AddressEnv;

  if (!USPS_CLIENT_ID || !USPS_CLIENT_SECRET) {
    return import.meta.env.DEV ? mockVerify(input) : { status: "unavailable" };
  }

  try {
    const token = await getUspsToken(USPS_CLIENT_ID, USPS_CLIENT_SECRET);
    const params = new URLSearchParams({
      streetAddress: input.addressLine1,
      city: input.city,
      state: input.state,
      ZIPCode: input.zip.slice(0, 5),
    });
    if (input.addressLine2) params.set("secondaryAddress", input.addressLine2);

    const res = await fetch(`https://apis.usps.com/addresses/v3/address?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 400 || res.status === 404) return { status: "invalid" };
    if (!res.ok) return { status: "unavailable" };

    const data = (await res.json()) as {
      address?: { streetAddress?: string; secondaryAddress?: string; city?: string; state?: string; ZIPCode?: string; ZIPPlus4?: string };
    };
    const a = data.address;
    if (!a?.streetAddress) return { status: "invalid" };

    const usps: Address = {
      addressLine1: a.streetAddress,
      addressLine2: a.secondaryAddress || undefined,
      city: a.city ?? input.city,
      state: a.state ?? input.state,
      zip: a.ZIPPlus4 ? `${a.ZIPCode}-${a.ZIPPlus4}` : (a.ZIPCode ?? input.zip),
    };
    return sameAddress(input, usps) ? { status: "ok", address: usps } : { status: "suggest", address: usps };
  } catch {
    return { status: "unavailable" };
  }
}

// One token per Worker instance until it expires; keeps us well under the USPS hourly limit
let cachedToken: { value: string; expiresAt: number } | undefined;

async function getUspsToken(clientId: string, clientSecret: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://apis.usps.com/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`USPS token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// Dev-only stand-in so the "Did you mean...?" prompt can be built and tested without USPS keys.
// "12 Main St #5" → "12 MAIN ST APT 5"; a street without a number is treated as invalid.
function mockVerify(input: Address): VerifyResult {
  if (!/^\d+\s/.test(input.addressLine1.trim())) return { status: "invalid" };
  const combined = [input.addressLine1, input.addressLine2].filter(Boolean).join(" ");
  const suggested: Address = {
    addressLine1: norm(combined.replace(/#\s*(\w+)/, "APT $1")),
    city: norm(input.city),
    state: norm(input.state),
    zip: input.zip.slice(0, 5),
  };
  return sameAddress(input, suggested) ? { status: "ok", address: suggested } : { status: "suggest", address: suggested };
}
