import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "./db";
import { REMINDER_DELAYS_MINUTES } from "./store-config";

// Runs on the cron trigger. Finds pending orders that are due their next reminder.
// Email sending is wired up in the Emails phase; for now it only logs.
export async function runPaymentReminders(env: Env) {
  const db = getDb(env.DB);
  const now = Date.now();

  const pending = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, "pending"),
        lt(schema.orders.remindersSent, REMINDER_DELAYS_MINUTES.length),
      ),
    );

  for (const order of pending) {
    const dueAt = order.createdAt.getTime() + REMINDER_DELAYS_MINUTES[order.remindersSent] * 60_000;
    if (now < dueAt) continue;

    // TODO (Emails phase): send reminder email via Resend before updating the count
    console.log(`Reminder ${order.remindersSent + 1} due for ${order.orderNumber}`);

    await db
      .update(schema.orders)
      .set({ remindersSent: order.remindersSent + 1, lastReminderAt: new Date(now) })
      .where(eq(schema.orders.id, order.id));
  }
}
