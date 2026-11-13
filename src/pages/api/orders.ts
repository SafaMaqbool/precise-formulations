import type { APIRoute } from "astro";
import { verifyAddress } from "../../lib/address";
import { OrderError, createOrder, parseOrderInput } from "../../lib/orders";
import { sendOrderPlacedEmails } from "../../lib/notifications";
import { verifyHuman } from "../../lib/turnstile";

/**
 * Places an order.
 * First call: checks the address. If USPS suggests a correction, returns it so the
 * customer can choose ("Did you mean...?"). Second call with addressConfirmed: true
 * saves the order with whichever address the customer picked.
 * Both calls must pass the Turnstile check (a widget token, or the ticket returned by the
 * first call), so bots can't place orders or use up the address-check quota.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ status: "error", message: "Invalid request." }, { status: 400 });
  }

  const { input, errors } = parseOrderInput(body);
  if (!input) return Response.json({ status: "invalid", errors }, { status: 422 });

  const human = await verifyHuman({
    token: body.turnstileToken,
    ticket: body.ticket,
    email: input.email,
    ip: request.headers.get("cf-connecting-ip"),
  });
  if (!human.ok) return Response.json({ status: "error", message: human.message }, { status: 403 });
  const ticket = human.ticket ?? (typeof body.ticket === "string" ? body.ticket : undefined);

  let addressVerified = false;
  if (body.addressConfirmed === true) {
    // Customer chose "Use suggested" (already USPS-verified) or "Keep mine" (not verified)
    addressVerified = body.usedSuggestion === true;
  } else {
    const check = await verifyAddress(input);
    if (check.status === "suggest") {
      return Response.json({ status: "suggest", suggested: check.address, ticket });
    }
    if (check.status === "invalid") {
      return Response.json(
        { status: "invalid", errors: { addressLine1: "We couldn't find this address. Please check it and try again." }, ticket },
        { status: 422 },
      );
    }
    addressVerified = check.status === "ok";
  }

  try {
    const order = await createOrder(input, addressVerified);
    // Order received (customer) + new order alert (client). A failed email doesn't fail the order.
    await sendOrderPlacedEmails(order);
    return Response.json({ status: "created", orderNumber: order.orderNumber });
  } catch (err) {
    if (err instanceof OrderError) {
      return Response.json({ status: "error", message: err.message }, { status: 409 });
    }
    console.error("Order failed", err);
    return Response.json({ status: "error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
};
