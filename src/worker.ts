import { handle } from "@astrojs/cloudflare/handler";
import { runPaymentReminders } from "./lib/reminders";

// Astro serves every request; the scheduled handler runs on the cron in wrangler.jsonc.
export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runPaymentReminders(env));
  },
} satisfies ExportedHandler<Env>;
