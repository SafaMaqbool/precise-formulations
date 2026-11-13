import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "./db";
import { sendPaymentReminder } from "./notifications";
import { REMINDER_DELAYS_MINUTES } from "./store-config";

// Runs on the cron trigger (every 15 minutes). Sends each unpaid order its next
// reminder once it's due. Paid, shipped and cancelled orders are never touched.
// The count only goes up after the email is sent, so a failed send retries next run.
export async function runPaymentReminders(env: Env) {
  const db = getDb(env.DB);
  const now = Date.now();

  const pending = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.status, "pending"), lt(schema.orders.remindersSent, REMINDER_DELAYS_MINUTES.length)));

  for (const order of pending) {
    const dueAt = order.createdAt.getTime() + REMINDER_DELAYS_MINUTES[order.remindersSent] * 60_000;
    if (now < dueAt) continue;

    const reminder = order.remindersSent + 1;
    const sent = await sendPaymentReminder(order, reminder).catch((err) => {
      console.error("Reminder failed", order.orderNumber, err);
      return false;
    });
    if (!sent) continue;

    // Only update if still pending, in case the client marked it paid meanwhile
    await db
      .update(schema.orders)
      .set({ remindersSent: reminder, lastReminderAt: new Date(now) })
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "pending")));
  }
}
