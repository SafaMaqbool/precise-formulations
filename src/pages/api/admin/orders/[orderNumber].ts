import type { APIRoute } from "astro";
import { applyAction, type AdminAction } from "../../../../lib/admin-orders";

const ACTIONS: AdminAction[] = ["mark-paid", "mark-shipped", "update-tracking", "cancel"];

// Handles the action buttons on the admin order page (plain HTML form posts)
export const POST: APIRoute = async ({ request, params, redirect, url }) => {
  // Only accept form posts from our own pages
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });

  const orderNumber = (params.orderNumber ?? "").toUpperCase();
  const form = await request.formData();
  const action = String(form.get("action") ?? "") as AdminAction;
  if (!ACTIONS.includes(action)) return new Response("Unknown action", { status: 400 });

  const result = await applyAction(orderNumber, action, String(form.get("trackingNumber") ?? ""));
  const back = new URL(`/admin/orders/${orderNumber}`, url);
  back.searchParams.set(result.ok ? (result.emailSent === false ? "warn" : "ok") : "error", result.message);
  return redirect(back.pathname + back.search, 303);
};
