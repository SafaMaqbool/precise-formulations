import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db";
import { BOTTLE_LIMIT, SHIPPING_RATES, generateOrderNumber } from "./store-config";
import { US_STATE_CODES } from "./us-states";
import type { Address } from "./address";

export interface OrderInput extends Address {
  email: string;
  customerName: string;
  shippingMethod: keyof typeof SHIPPING_RATES;
  items: { slug: string; quantity: number }[];
  agreed: boolean;
}

export type FieldErrors = Partial<Record<string, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP = /^\d{5}(-\d{4})?$/;

/** Validates the raw request body. Returns clean input or field errors for the form. */
export function parseOrderInput(body: unknown): { input?: OrderInput; errors?: FieldErrors } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const errors: FieldErrors = {};

  const input: OrderInput = {
    email: str("email").toLowerCase(),
    customerName: str("customerName"),
    addressLine1: str("addressLine1"),
    addressLine2: str("addressLine2") || undefined,
    city: str("city"),
    state: str("state").toUpperCase(),
    zip: str("zip"),
    shippingMethod: str("shippingMethod") as OrderInput["shippingMethod"],
    items: Array.isArray(b.items)
      ? (b.items as { slug?: unknown; quantity?: unknown }[])
          .map((i) => ({ slug: String(i?.slug ?? ""), quantity: Number(i?.quantity ?? 0) }))
          .filter((i) => i.slug && Number.isInteger(i.quantity) && i.quantity > 0)
      : [],
    agreed: b.agreed === true,
  };

  if (!EMAIL.test(input.email)) errors.email = "Enter a valid email address.";
  if (input.customerName.length < 2) errors.customerName = "Enter your full name.";
  if (!input.addressLine1) errors.addressLine1 = "Enter your street address.";
  if (!input.city) errors.city = "Enter your city.";
  if (!US_STATE_CODES.has(input.state)) errors.state = "Choose a state.";
  if (!ZIP.test(input.zip)) errors.zip = "Enter a 5-digit ZIP code.";
  if (!(input.shippingMethod in SHIPPING_RATES)) errors.shippingMethod = "Choose a shipping option.";
  if (!input.agreed) errors.agreed = "Please agree to the payment terms to place your order.";

  const total = input.items.reduce((n, i) => n + i.quantity, 0);
  if (total === 0) errors.items = "Add at least one serum.";
  else if (BOTTLE_LIMIT.mode === "per-order" && total > BOTTLE_LIMIT.max)
    errors.items = `Up to ${BOTTLE_LIMIT.max} bottles per order.`;
  else if (BOTTLE_LIMIT.mode === "per-product" && input.items.some((i) => i.quantity > BOTTLE_LIMIT.max))
    errors.items = `Up to ${BOTTLE_LIMIT.max} of each serum per order.`;

  return Object.keys(errors).length ? { errors } : { input };
}

/** Saves the order using prices from the database, never from the browser. */
export async function createOrder(input: OrderInput, addressVerified: boolean) {
  const db = getDb();
  const slugs = input.items.map((i) => i.slug);
  const products = await db
    .select()
    .from(schema.products)
    .where(inArray(schema.products.slug, slugs));

  const lines = input.items.map((item) => {
    const product = products.find((p) => p.slug === item.slug && p.active);
    if (!product) throw new OrderError("One of the serums is no longer available. Please refresh and try again.");
    return { product, quantity: item.quantity };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
  const shippingCents = SHIPPING_RATES[input.shippingMethod].cents;

  // Order numbers are random; retry on the rare clash with an existing one
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      const [order] = await db
        .insert(schema.orders)
        .values({
          orderNumber,
          customerName: input.customerName,
          email: input.email,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2,
          city: input.city,
          state: input.state,
          zip: input.zip,
          addressVerified,
          shippingMethod: input.shippingMethod,
          shippingCents,
          subtotalCents,
          totalCents: subtotalCents + shippingCents,
        })
        .returning();

      try {
        await db.insert(schema.orderItems).values(
          lines.map((l) => ({
            orderId: order.id,
            productId: l.product.id,
            quantity: l.quantity,
            unitPriceCents: l.product.priceCents,
          })),
        );
      } catch (err) {
        await db.delete(schema.orders).where(eq(schema.orders.id, order.id));
        throw err;
      }

      // TODO (Phase 4): send the order received email and notify the client
      return order;
    } catch (err) {
      if (String(err).includes("UNIQUE") && String(err).includes("order_number")) continue;
      throw err;
    }
  }
  throw new OrderError("We couldn't save your order. Please try again.");
}

export class OrderError extends Error {}
