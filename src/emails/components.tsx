import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text, Row, Column } from "@react-email/components";
import type { EmailOrder, PaymentDetails } from "./types";

// Brand colors from the brief. Email clients don't load web fonts reliably,
// so emails use a Georgia/Arial fallback of the site's type.
export const color = {
  paper: "#f4f0e6",
  band: "#ece4d5",
  ink: "#1d1713",
  muted: "#5e5650",
  accent: "#1d3172",
  rule: "#d9cfbd",
};

const sans = "'Hanken Grotesk', Arial, Helvetica, sans-serif";
const serif = "'Libre Caslon Display', Georgia, 'Times New Roman', serif";

export const text = { fontFamily: sans, fontSize: "16px", lineHeight: "24px", color: color.ink, margin: "0 0 16px" };
export const muted = { ...text, color: color.muted, fontSize: "14px", lineHeight: "20px" };
export const heading = { fontFamily: serif, fontSize: "32px", lineHeight: "36px", fontWeight: 400, color: color.ink, margin: "0 0 16px" };

export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: color.paper, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "0 20px" }}>
          <Text style={{ ...text, fontWeight: 600, fontSize: "18px", borderBottom: `1px solid ${color.ink}`, paddingBottom: "12px", marginBottom: "28px" }}>
            Precise Formulations
          </Text>
          {children}
          <Hr style={{ borderColor: color.rule, margin: "32px 0 16px" }} />
          <Text style={muted}>Precise Formulations · Pay by Venmo or Zelle · US delivery only</Text>
          <Text style={muted}>Questions about your order? Reply to this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function PaymentBox({ order, payment }: { order: EmailOrder; payment: PaymentDetails }) {
  return (
    <Section style={{ backgroundColor: color.band, padding: "20px", margin: "8px 0 24px" }}>
      <Text style={{ ...muted, margin: "0 0 4px" }}>Put only this in the payment memo</Text>
      <Text style={{ ...text, fontSize: "26px", lineHeight: "32px", fontWeight: 700, letterSpacing: "1px", margin: "0 0 16px" }}>
        {order.orderNumber}
      </Text>
      <Row>
        <Column style={{ width: "50%", verticalAlign: "top", borderTop: `1px solid ${color.ink}`, paddingTop: "8px" }}>
          <Text style={{ ...text, fontWeight: 600, margin: 0 }}>Venmo</Text>
          <Text style={{ ...text, margin: 0 }}>{payment.venmo}</Text>
        </Column>
        <Column style={{ width: "50%", verticalAlign: "top", borderTop: `1px solid ${color.ink}`, paddingTop: "8px", paddingLeft: "12px" }}>
          <Text style={{ ...text, fontWeight: 600, margin: 0 }}>Zelle</Text>
          <Text style={{ ...text, margin: 0 }}>{payment.zelle}</Text>
        </Column>
      </Row>
      <Text style={{ ...text, fontWeight: 600, margin: "16px 0 0" }}>Amount: {order.total}</Text>
    </Section>
  );
}

export function OrderSummary({ order }: { order: EmailOrder }) {
  const line = (label: string, value: string, bold = false) => (
    <Row key={label} style={{ borderTop: `1px solid ${color.rule}` }}>
      <Column style={{ padding: "8px 0" }}>
        <Text style={{ ...text, margin: 0, fontWeight: bold ? 600 : 400 }}>{label}</Text>
      </Column>
      <Column style={{ padding: "8px 0", textAlign: "right" }}>
        <Text style={{ ...text, margin: 0, fontWeight: bold ? 600 : 400 }}>{value}</Text>
      </Column>
    </Row>
  );
  return (
    <Section style={{ margin: "0 0 24px" }}>
      <Text style={{ ...text, fontWeight: 600, margin: "0 0 8px" }}>Order {order.orderNumber}</Text>
      {order.items.map((i) => line(`${i.name} × ${i.quantity}`, i.lineTotal))}
      {line(`${order.shippingLabel} shipping`, order.shipping)}
      {line("Total", order.total, true)}
    </Section>
  );
}

export function ShippingAddress({ order }: { order: EmailOrder }) {
  return (
    <Section style={{ margin: "0 0 8px" }}>
      <Text style={{ ...text, fontWeight: 600, margin: "0 0 4px" }}>Shipping to</Text>
      <Text style={{ ...text, margin: 0 }}>
        {order.customerName}
        {order.addressLines.map((l, i) => (
          <span key={i}>
            <br />
            {l}
          </span>
        ))}
      </Text>
    </Section>
  );
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
