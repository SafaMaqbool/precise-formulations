import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// Money is stored in cents to avoid rounding errors.

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  // Short label on the bottle and badge, so the two hair serums are easy to tell apart
  shortLabel: text("short_label"),
  activeIngredients: text("active_ingredients").notNull(),
  strength: text("strength").notNull(),
  size: text("size").notNull(),
  ingredients: text("ingredients"),
  preservedWith: text("preserved_with"),
  priceCents: integer("price_cents").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const ORDER_STATUSES = ["pending", "paid", "shipped", "cancelled"] as const;
export const SHIPPING_METHODS = ["standard", "express"] as const;

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNumber: text("order_number").notNull().unique(), // PF-XXXXXX
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),

    customerName: text("customer_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),

    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    // false when the USPS check was skipped (API down or rate limited); the admin should review
    addressVerified: integer("address_verified", { mode: "boolean" }).notNull().default(false),

    shippingMethod: text("shipping_method", { enum: SHIPPING_METHODS }).notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalCents: integer("total_cents").notNull(),

    trackingNumber: text("tracking_number"),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: integer("last_reminder_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    shippedAt: integer("shipped_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
  },
  (t) => [index("orders_status_created_idx").on(t.status, t.createdAt)],
);

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(), // price at time of order
});

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
