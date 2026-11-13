import { createElement } from "react";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "./db";
import { sendEmail } from "./email";
import { REMINDER_DELAYS_MINUTES, SHIPPING_RATES, TRACKING_URL, formatPrice } from "./store-config";
import type { Order } from "../../db/schema";
import type { EmailOrder, PaymentDetails } from "../emails/types";
import {
  NewOrderNotificationEmail,
  OrderCancelledEmail,
  OrderConfirmedEmail,
  OrderReceivedEmail,
  OrderShippedEmail,
  PaymentReminderEmail,
} from "../emails/templates";

type NotifyEnv = { CLIENT_NOTIFY_EMAIL?: string; VENMO_HANDLE?: string; ZELLE_CONTACT?: string };
const cfg = () => env as unknown as NotifyEnv;

const SITE = import.meta.env.SITE ?? "https://www.preciseformulations.cc";

export function paymentDetails(): PaymentDetails {
  return {
    venmo: cfg().VENMO_HANDLE || "Venmo handle not set",
    zelle: cfg().ZELLE_CONTACT || "Zelle contact not set",
  };
}

/** Loads an order's items and formats everything the email templates show */
export async function toEmailOrder(order: Order): Promise<EmailOrder> {
  const items = await getDb()
    .select({ name: schema.products.name, quantity: schema.orderItems.quantity, unitPriceCents: schema.orderItems.unitPriceCents })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
    .where(eq(schema.orderItems.orderId, order.id));

  return {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    email: order.email,
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: formatPrice(i.unitPriceCents * i.quantity) })),
    subtotal: formatPrice(order.subtotalCents),
    shipping: formatPrice(order.shippingCents),
    shippingLabel: SHIPPING_RATES[order.shippingMethod].label,
    total: formatPrice(order.totalCents),
    addressLines: [
      [order.addressLine1, order.addressLine2].filter(Boolean).join(", "),
      `${order.city}, ${order.state} ${order.zip}`,
    ],
    addressVerified: order.addressVerified,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingNumber ? TRACKING_URL(order.trackingNumber) : null,
  };
}

/** Order received (customer) + new order alert (client). Never throws: a failed email must not lose the order. */
export async function sendOrderPlacedEmails(order: Order) {
  try {
    const data = await toEmailOrder(order);
    const results = [
      await sendEmail({
        to: order.email,
        subject: `Order ${order.orderNumber}: send ${data.total} to complete your order`,
        idempotencyKey: `order-received/${order.orderNumber}`,
        react: createElement(OrderReceivedEmail, { order: data, payment: paymentDetails() }),
      }),
    ];
    const clientEmail = cfg().CLIENT_NOTIFY_EMAIL;
    if (clientEmail && !clientEmail.startsWith("replace-with")) {
      results.push(
        await sendEmail({
          to: clientEmail,
          subject: `New order ${order.orderNumber}: ${data.total} from ${order.customerName}`,
          idempotencyKey: `order-alert/${order.orderNumber}`,
          react: createElement(NewOrderNotificationEmail, { order: data, adminUrl: `${SITE}/admin/orders/${order.orderNumber}` }),
          replyTo: order.email,
        }),
      );
    }
    return results.every((r) => r.ok);
  } catch (err) {
    console.error("Order placed emails failed", order.orderNumber, err);
    return false;
  }
}

export async function sendPaymentReminder(order: Order, reminder: number) {
  const data = await toEmailOrder(order);
  const result = await sendEmail({
    to: order.email,
    subject: `Reminder: payment for order ${order.orderNumber}`,
    idempotencyKey: `payment-reminder-${reminder}/${order.orderNumber}`,
    react: createElement(PaymentReminderEmail, {
      order: data,
      payment: paymentDetails(),
      reminder,
      totalReminders: REMINDER_DELAYS_MINUTES.length,
    }),
  });
  return result.ok;
}

/** Sent by the admin portal (Phase 5) when the client changes an order's status */
export async function sendStatusEmail(order: Order, kind: "confirmed" | "shipped" | "cancelled") {
  const data = await toEmailOrder(order);
  const email = {
    confirmed: { subject: `Payment received for order ${order.orderNumber}`, react: createElement(OrderConfirmedEmail, { order: data }) },
    shipped: { subject: `Order ${order.orderNumber} has shipped`, react: createElement(OrderShippedEmail, { order: data }) },
    cancelled: { subject: `Order ${order.orderNumber} has been cancelled`, react: createElement(OrderCancelledEmail, { order: data }) },
  }[kind];
  // Tracking number is part of the key so a corrected tracking number can be re-sent
  const idempotencyKey = `order-${kind}/${order.orderNumber}${kind === "shipped" ? `/${order.trackingNumber ?? ""}` : ""}`;
  const result = await sendEmail({ to: order.email, ...email, idempotencyKey });
  return result.ok;
}
