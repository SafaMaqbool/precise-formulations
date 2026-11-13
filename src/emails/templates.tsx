import { Button, Section, Text } from "@react-email/components";
import { Layout, OrderSummary, PaymentBox, ShippingAddress, color, firstName, heading, muted, text } from "./components";
import type { EmailOrder, PaymentDetails } from "./types";

// PLACEHOLDER COPY: replace with the wording from the current site's emails once the client sends it.

export function OrderReceivedEmail({ order, payment }: { order: EmailOrder; payment: PaymentDetails }) {
  return (
    <Layout preview={`Send ${order.total} by Venmo or Zelle to complete order ${order.orderNumber}`}>
      <Text style={heading}>Send {order.total} to complete your order</Text>
      <Text style={text}>Hi {firstName(order.customerName)}, thanks for your order. To complete it, please send {order.total} by Venmo or Zelle within 4 hours, with only your order number in the memo.</Text>
      <PaymentBox order={order} payment={payment} />
      <OrderSummary order={order} />
      <ShippingAddress order={order} />
      <Text style={muted}>Once we match your payment, we'll email you a confirmation. Orders not paid in time may be cancelled.</Text>
    </Layout>
  );
}

export function PaymentReminderEmail({ order, payment, reminder, totalReminders }: { order: EmailOrder; payment: PaymentDetails; reminder: number; totalReminders: number }) {
  const last = reminder >= totalReminders;
  return (
    <Layout preview={`We haven't received payment for order ${order.orderNumber} yet`}>
      <Text style={heading}>{last ? "Last reminder: your order is still unpaid" : "Your order is waiting for payment"}</Text>
      <Text style={text}>
        Hi {firstName(order.customerName)}, we haven't received payment for order {order.orderNumber} yet.
        {last ? " This is the last reminder. If we don't receive payment soon, your order will be cancelled." : " Please send it when you can so we can ship your serums."}
      </Text>
      <PaymentBox order={order} payment={payment} />
      <OrderSummary order={order} />
      <Text style={muted}>Already paid? Thanks! It can take a little while for us to match payments, so you can ignore this email.</Text>
    </Layout>
  );
}

export function OrderConfirmedEmail({ order }: { order: EmailOrder }) {
  return (
    <Layout preview={`Payment received for order ${order.orderNumber}. We'll ship it soon.`}>
      <Text style={heading}>Payment received</Text>
      <Text style={text}>Hi {firstName(order.customerName)}, we've received your payment for order {order.orderNumber}. Your order is confirmed and will ship soon. We'll email your tracking number when it does.</Text>
      <OrderSummary order={order} />
      <ShippingAddress order={order} />
    </Layout>
  );
}

export function OrderShippedEmail({ order }: { order: EmailOrder }) {
  return (
    <Layout preview={`Order ${order.orderNumber} has shipped`}>
      <Text style={heading}>Your order has shipped</Text>
      <Text style={text}>Hi {firstName(order.customerName)}, order {order.orderNumber} is on its way.</Text>
      {order.trackingNumber && (
        <Section style={{ backgroundColor: color.band, padding: "20px", margin: "8px 0 24px" }}>
          <Text style={{ ...muted, margin: "0 0 4px" }}>Tracking number</Text>
          <Text style={{ ...text, fontSize: "20px", fontWeight: 700, margin: order.trackingUrl ? "0 0 16px" : 0 }}>{order.trackingNumber}</Text>
          {order.trackingUrl && (
            <Button href={order.trackingUrl} style={{ backgroundColor: color.accent, color: color.paper, padding: "12px 20px", fontWeight: 600, fontSize: "16px", fontFamily: text.fontFamily }}>
              Track your package
            </Button>
          )}
        </Section>
      )}
      <OrderSummary order={order} />
      <ShippingAddress order={order} />
    </Layout>
  );
}

export function OrderCancelledEmail({ order }: { order: EmailOrder }) {
  return (
    <Layout preview={`Order ${order.orderNumber} has been cancelled`}>
      <Text style={heading}>Your order has been cancelled</Text>
      <Text style={text}>Hi {firstName(order.customerName)}, we didn't receive payment for order {order.orderNumber}, so it has been cancelled.</Text>
      <Text style={text}>If you already sent payment, please reply to this email with the details and we'll sort it out. You're welcome to place a new order any time.</Text>
      <OrderSummary order={order} />
    </Layout>
  );
}

// Sent to the client (store owner) for every new order
export function NewOrderNotificationEmail({ order, adminUrl }: { order: EmailOrder; adminUrl: string }) {
  return (
    <Layout preview={`New order ${order.orderNumber}: ${order.total} from ${order.customerName}`}>
      <Text style={heading}>New order {order.orderNumber}</Text>
      <Text style={text}>{order.customerName} ({order.email}) placed an order for {order.total}. Watch for a Venmo or Zelle payment with {order.orderNumber} in the memo.</Text>
      {!order.addressVerified && (
        <Section style={{ border: `1px solid ${color.ink}`, padding: "12px 16px", margin: "0 0 24px" }}>
          <Text style={{ ...text, margin: 0, fontWeight: 600 }}>Address not verified. Please check it before shipping.</Text>
        </Section>
      )}
      <OrderSummary order={order} />
      <ShippingAddress order={order} />
      <Button href={adminUrl} style={{ backgroundColor: color.accent, color: color.paper, padding: "12px 20px", fontWeight: 600, fontSize: "16px", fontFamily: text.fontFamily, marginTop: "16px" }}>
        Open in admin portal
      </Button>
    </Layout>
  );
}
