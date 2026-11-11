// Store rules from the brief. Items marked PENDING wait on answers from the client (brief Part 3).

export const SHIPPING_RATES = {
  standard: { label: "Standard", cents: 800, eta: "3–5 business days" },
  express: { label: "Express", cents: 1300, eta: "1–3 business days" },
} as const;

// PENDING: 4 bottles per order, or 4 of each product?
export const BOTTLE_LIMIT = { mode: "per-order" as "per-order" | "per-product", max: 4 };

// PENDING: real timings from the current system. First reminder is 30 minutes (confirmed).
export const REMINDER_DELAYS_MINUTES = [30, 60 * 24, 60 * 48];

export const AGREEMENT_TEXT =
  "I agree to submit payment within 4 hours of submitting my order or risk my order being cancelled. The next page will show payment instructions.";

export function formatPrice(cents: number) {
  // Whole-dollar prices show as $35, others as $35.50
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

// PF- followed by 6 characters, without look-alike characters (0/O, 1/I)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateOrderNumber() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "PF-" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
