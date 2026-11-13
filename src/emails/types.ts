// Everything an email needs about an order, already formatted for display
export interface EmailOrder {
  orderNumber: string;
  customerName: string;
  email: string;
  items: { name: string; quantity: number; lineTotal: string }[];
  subtotal: string;
  shipping: string;
  shippingLabel: string;
  total: string;
  addressLines: string[];
  addressVerified: boolean;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

export interface PaymentDetails {
  venmo: string;
  zelle: string;
}
