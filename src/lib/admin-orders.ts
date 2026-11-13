import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { sendStatusEmail } from "./notifications";
import type { Order, OrderStatus } from "../../db/schema";
import { ORDER_STATUSES } from "../../db/schema";

const LIST_LIMIT = 200;

export async function listOrders(opts: { status?: string | null; q?: string | null }) {
  const db = getDb();
  const filters = [];
  if (opts.status && (ORDER_STATUSES as readonly string[]).includes(opts.status)) {
    filters.push(eq(schema.orders.status, opts.status as OrderStatus));
  }
  const q = opts.q?.trim();
  if (q) {
    const term = `%${q}%`;
    filters.push(
      or(like(schema.orders.orderNumber, term.toUpperCase()), like(schema.orders.email, term.toLowerCase()), like(schema.orders.customerName, term)),
    );
  }

  const orders = await db
    .select()
    .from(schema.orders)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
    .limit(LIST_LIMIT);

  const bottles = orders.length
    ? await db
        .select({ orderId: schema.orderItems.orderId, count: sql<number>`sum(${schema.orderItems.quantity})` })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, orders.map((o) => o.id)))
        .groupBy(schema.orderItems.orderId)
    : [];
  const bottleCount = new Map(bottles.map((b) => [b.orderId, Number(b.count)]));

  const counts = await db
    .select({ status: schema.orders.status, count: sql<number>`count(*)` })
    .from(schema.orders)
    .groupBy(schema.orders.status);

  return {
    orders: orders.map((o) => ({ ...o, bottles: bottleCount.get(o.id) ?? 0 })),
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])) as Partial<Record<OrderStatus, number>>,
    truncated: orders.length === LIST_LIMIT,
  };
}

export async function getOrder(orderNumber: string) {
  const db = getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.orderNumber, orderNumber)).limit(1);
  if (!order) return null;
  const items = await db
    .select({ name: schema.products.name, quantity: schema.orderItems.quantity, unitPriceCents: schema.orderItems.unitPriceCents })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
    .where(eq(schema.orderItems.orderId, order.id));
  return { order, items };
}

export type AdminAction = "mark-paid" | "mark-shipped" | "update-tracking" | "cancel";

export interface ActionResult {
  ok: boolean;
  message: string;
  emailSent?: boolean;
}

/**
 * Applies one admin action. Each update only succeeds if the order is still in the
 * status the action expects, so two clicks (or two people) can't apply it twice.
 */
export async function applyAction(orderNumber: string, action: AdminAction, trackingNumber?: string): Promise<ActionResult> {
  const db = getDb();
  const found = await getOrder(orderNumber);
  if (!found) return { ok: false, message: "Order not found." };
  const { order } = found;
  const now = new Date();
  const tracking = trackingNumber?.trim().replace(/\s+/g, "") ?? "";

  const update = async (from: OrderStatus, values: Partial<Order>) => {
    const rows = await db
      .update(schema.orders)
      .set(values)
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, from)))
      .returning();
    return rows[0];
  };

  const withEmail = async (updated: Order, kind: "confirmed" | "shipped" | "cancelled", done: string) => {
    const emailSent = await sendStatusEmail(updated, kind).catch(() => false);
    return emailSent
      ? { ok: true, emailSent, message: `${done} The customer has been emailed.` }
      : { ok: true, emailSent, message: `${done} The email to the customer couldn't be sent, so please contact them directly.` };
  };

  switch (action) {
    case "mark-paid": {
      if (order.status !== "pending") return { ok: false, message: `This order is already ${order.status}.` };
      const updated = await update("pending", { status: "paid", paidAt: now });
      if (!updated) return { ok: false, message: "The order changed in the meantime. Please refresh." };
      return withEmail(updated, "confirmed", "Marked as paid.");
    }
    case "mark-shipped": {
      if (order.status !== "paid") return { ok: false, message: "Only paid orders can be marked as shipped." };
      if (tracking.length < 8) return { ok: false, message: "Enter the tracking number before marking as shipped." };
      const updated = await update("paid", { status: "shipped", shippedAt: now, trackingNumber: tracking });
      if (!updated) return { ok: false, message: "The order changed in the meantime. Please refresh." };
      return withEmail(updated, "shipped", "Marked as shipped.");
    }
    case "update-tracking": {
      if (order.status !== "shipped") return { ok: false, message: "Tracking can only be corrected on shipped orders." };
      if (tracking.length < 8) return { ok: false, message: "Enter the corrected tracking number." };
      if (tracking === order.trackingNumber) return { ok: false, message: "That's the same tracking number." };
      const updated = await update("shipped", { trackingNumber: tracking });
      if (!updated) return { ok: false, message: "The order changed in the meantime. Please refresh." };
      return withEmail(updated, "shipped", "Tracking number updated.");
    }
    case "cancel": {
      if (order.status !== "pending") return { ok: false, message: "Only unpaid orders can be cancelled here." };
      const updated = await update("pending", { status: "cancelled", cancelledAt: now });
      if (!updated) return { ok: false, message: "The order changed in the meantime. Please refresh." };
      return withEmail(updated, "cancelled", "Order cancelled.");
    }
    default:
      return { ok: false, message: "Unknown action." };
  }
}
