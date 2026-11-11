import type { APIRoute } from "astro";
import { verifyAddress } from "../../lib/address";
import { OrderError, createOrder, parseOrderInput } from "../../lib/orders";

/**
 * Places an order.
 * First call: checks the address. If USPS suggests a correction, returns it so the
 * customer can choose ("Did you mean...?"). Second call with addressConfirmed: true
 * saves the order with whichever address the customer picked.
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

  let addressVerified = false;
  if (body.addressConfirmed === true) {
    // Customer chose "Use suggested" (already USPS-verified) or "Keep mine" (not verified)
    addressVerified = body.usedSuggestion === true;
  } else {
    const check = await verifyAddress(input);
    if (check.status === "suggest") {
      return Response.json({ status: "suggest", suggested: check.address });
    }
    if (check.status === "invalid") {
      return Response.json(
        { status: "invalid", errors: { addressLine1: "We couldn't find this address. Please check it and try again." } },
        { status: 422 },
      );
    }
    addressVerified = check.status === "ok";
  }

  try {
    const order = await createOrder(input, addressVerified);
    return Response.json({ status: "created", orderNumber: order.orderNumber });
  } catch (err) {
    if (err instanceof OrderError) {
      return Response.json({ status: "error", message: err.message }, { status: 409 });
    }
    console.error("Order failed", err);
    return Response.json({ status: "error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
};
