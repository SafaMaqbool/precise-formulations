import { useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";

// Cloudflare Turnstile browser API (loaded from challenges.cloudflare.com)
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<NonNullable<Window["turnstile"]>> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = TURNSTILE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"))));
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
  });
}

interface CheckoutProduct {
  slug: string;
  name: string;
  shortLabel: string | null;
  priceCents: number;
}

interface ShippingRate {
  label: string;
  cents: number;
  eta: string;
}

interface Address {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

interface Props {
  products: CheckoutProduct[];
  preselected: string | null;
  shippingRates: Record<string, ShippingRate>;
  bottleLimit: { mode: "per-order" | "per-product"; max: number };
  agreementText: string;
  states: readonly (readonly [string, string])[];
  /** Turnstile site key; null when spam protection isn't set up */
  turnstileSiteKey: string | null;
}

type Errors = Partial<Record<string, string>>;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export default function CheckoutForm({ products, preselected, shippingRates, bottleLimit, agreementText, states, turnstileSiteKey }: Props) {
  const firstSlug = products.some((p) => p.slug === preselected) ? preselected! : products[0]?.slug;

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.slug, p.slug === firstSlug ? 1 : 0])),
  );
  const [form, setForm] = useState({
    email: "",
    customerName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
  });
  const [shippingMethod, setShippingMethod] = useState(Object.keys(shippingRates)[0]);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggestion, setSuggestion] = useState<Address | null>(null);

  // Spam protection: a one-time token from the widget, then a short-lived ticket from the server
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [humanError, setHumanError] = useState(false);
  const needsCheck = Boolean(turnstileSiteKey) && !token && !ticket;

  useEffect(() => {
    if (!turnstileSiteKey || !widgetRef.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !widgetRef.current || widgetId.current) return;
        widgetId.current = ts.render(widgetRef.current, {
          sitekey: turnstileSiteKey,
          size: "flexible",
          theme: "light",
          callback: (t: string) => {
            setToken(t);
            setHumanError(false);
          },
          "expired-callback": () => setToken(null),
          "error-callback": () => {
            setToken(null);
            setHumanError(true);
          },
        });
      })
      .catch(() => setHumanError(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [turnstileSiteKey]);

  // Tokens work once: after sending one, get a fresh token for the next attempt
  const resetWidget = () => {
    setToken(null);
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  };

  const totalBottles = Object.values(qty).reduce((a, b) => a + b, 0);
  const subtotal = products.reduce((sum, p) => sum + p.priceCents * (qty[p.slug] ?? 0), 0);
  const shipping = shippingRates[shippingMethod]?.cents ?? 0;
  const total = subtotal + shipping;

  const limitNote =
    bottleLimit.mode === "per-order"
      ? `Up to ${bottleLimit.max} bottles per order.`
      : `Up to ${bottleLimit.max} of each serum per order.`;

  const canAdd = (slug: string) =>
    bottleLimit.mode === "per-order" ? totalBottles < bottleLimit.max : (qty[slug] ?? 0) < bottleLimit.max;

  const change = (slug: string, delta: number) =>
    setQty((q) => ({ ...q, [slug]: Math.max(0, (q[slug] ?? 0) + delta) }));

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const payload = useMemo(
    () => ({
      ...form,
      shippingMethod,
      agreed,
      items: Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([slug, quantity]) => ({ slug, quantity })),
    }),
    [form, shippingMethod, agreed, qty],
  );

  async function submit(extra: Record<string, unknown> = {}, override?: Address) {
    setSubmitting(true);
    setFormError("");
    const sentToken = token;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...override, ...extra, turnstileToken: sentToken, ticket }),
      });
      const data = (await res.json()) as {
        status: string;
        orderNumber?: string;
        suggested?: Address;
        errors?: Errors;
        message?: string;
        ticket?: string;
      };
      if (data.status !== "created") {
        if (data.ticket) setTicket(data.ticket);
        if (sentToken) resetWidget();
        if (res.status === 403) setTicket(null);
      }

      if (data.status === "created") {
        window.location.href = `/order/${data.orderNumber}`;
        return;
      }
      if (data.status === "suggest") {
        setSuggestion(data.suggested ?? null);
      } else if (data.status === "invalid") {
        setErrors(data.errors ?? {});
        setSuggestion(null);
      } else {
        setFormError(data.message ?? "Something went wrong. Please try again.");
        setSuggestion(null);
      }
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
    }
    setSubmitting(false);
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!submitting) submit();
  }

  function useSuggested() {
    if (!suggestion) return;
    setForm((f) => ({
      ...f,
      addressLine1: suggestion.addressLine1,
      addressLine2: suggestion.addressLine2 ?? "",
      city: suggestion.city,
      state: suggestion.state,
      zip: suggestion.zip,
    }));
    // Matches the current site: choosing the suggestion places the order straight away
    submit({ addressConfirmed: true, usedSuggestion: true }, { ...suggestion, addressLine2: suggestion.addressLine2 ?? "" });
  }

  const enteredAddress = [form.addressLine1, form.addressLine2].filter(Boolean).join(", ");
  const suggestedAddress = suggestion ? [suggestion.addressLine1, suggestion.addressLine2].filter(Boolean).join(", ") : "";

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-10 pb-28 lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-16 lg:pb-0">
      {/* Left: where it goes and how */}
      <div>
        <h2 className="text-lg font-semibold">Where should it go?</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <Field label="Email" error={errors.email} className="sm:col-span-6">
            <input type="email" autoComplete="email" value={form.email} onChange={set("email")} className={inputClass(errors.email)} />
          </Field>
          <Field label="Full name" error={errors.customerName} className="sm:col-span-6">
            <input autoComplete="name" value={form.customerName} onChange={set("customerName")} className={inputClass(errors.customerName)} />
          </Field>
          <Field label="Street address" error={errors.addressLine1} className="sm:col-span-6">
            <input autoComplete="address-line1" value={form.addressLine1} onChange={set("addressLine1")} className={inputClass(errors.addressLine1)} />
          </Field>
          <Field label="Apt or suite (optional)" className="sm:col-span-6">
            <input autoComplete="address-line2" value={form.addressLine2} onChange={set("addressLine2")} className={inputClass()} />
          </Field>
          <Field label="City" error={errors.city} className="sm:col-span-2">
            <input autoComplete="address-level2" value={form.city} onChange={set("city")} className={inputClass(errors.city)} />
          </Field>
          <Field label="State" error={errors.state} className="sm:col-span-2">
            <select autoComplete="address-level1" value={form.state} onChange={set("state")} className={inputClass(errors.state)}>
              <option value="">Select</option>
              {states.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </Field>
          <Field label="ZIP" error={errors.zip} className="sm:col-span-2">
            <input inputMode="numeric" autoComplete="postal-code" value={form.zip} onChange={set("zip")} className={inputClass(errors.zip)} />
          </Field>
        </div>

        <h2 className="mt-10 text-lg font-semibold">Shipping</h2>
        <div className="mt-4 border-t border-ink/80">
          {Object.entries(shippingRates).map(([key, rate]) => (
            <label key={key} className="flex cursor-pointer items-center gap-4 border-b border-rule px-3 py-3 has-[:checked]:bg-band">
              <input type="radio" name="shipping" value={key} checked={shippingMethod === key} onChange={() => setShippingMethod(key)} className="size-4 accent-accent" />
              <span className="flex-1">
                <span className="block font-semibold">{rate.label}</span>
                <span className="block text-sm text-ink-muted">{rate.eta}</span>
              </span>
              <span className="font-semibold tabular-nums">{money(rate.cents)}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-muted">US delivery only.</p>
      </div>

      {/* Right: summary, stays in view on desktop */}
      <aside id="summary" className="bg-band p-6 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">Summary</h2>
        <ul className="mt-4">
          {products.map((p) => (
            <li key={p.slug} className="flex items-center gap-3 border-t border-rule py-3">
              <span className="grid size-10 shrink-0 place-items-center bg-accent text-[0.625rem] font-semibold leading-tight text-accent-ink" aria-hidden>
                {p.shortLabel}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{p.name}</span>
                <span className="block text-sm text-ink-muted">{money(p.priceCents)}</span>
              </span>
              <span className="flex items-center">
                <button type="button" onClick={() => change(p.slug, -1)} disabled={!qty[p.slug]} className="grid size-8 place-items-center border border-rule bg-paper disabled:opacity-40" aria-label={`Remove one ${p.name}`}>−</button>
                <span className="w-8 text-center tabular-nums" aria-live="polite">{qty[p.slug] ?? 0}</span>
                <button type="button" onClick={() => change(p.slug, 1)} disabled={!canAdd(p.slug)} className="grid size-8 place-items-center border border-rule bg-paper disabled:opacity-40" aria-label={`Add one ${p.name}`}>+</button>
              </span>
            </li>
          ))}
        </ul>
        <p className={`border-t border-rule pt-3 text-sm ${errors.items ? "text-red-700" : "text-ink-muted"}`}>{errors.items ?? limitNote}</p>

        <dl className="mt-4 text-sm">
          <div className="flex justify-between py-1"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
          <div className="flex justify-between py-1"><dt className="text-ink-muted">Shipping</dt><dd className="tabular-nums">{money(shipping)}</dd></div>
        </dl>
        <div className="mt-2 flex items-baseline justify-between border-t border-ink/80 pt-3">
          <span className="font-semibold">Total</span>
          <span className="display text-[2.5rem]">{money(total)}</span>
        </div>

        <label className="mt-5 flex cursor-pointer gap-3 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setErrors((er) => ({ ...er, agreed: undefined })); }} className="mt-0.5 size-4 shrink-0 accent-accent" />
          <span>{agreementText}</span>
        </label>
        {errors.agreed && <p className="mt-2 text-sm text-red-700">{errors.agreed}</p>}

        {turnstileSiteKey && <div ref={widgetRef} className="mt-5 min-h-[65px]" />}
        {humanError && (
          <p className="mt-2 text-sm text-red-700">The security check couldn't load. Please refresh the page or try another browser.</p>
        )}

        <button type="submit" disabled={submitting || totalBottles === 0 || needsCheck} className="btn-primary mt-5 w-full disabled:opacity-60">
          {submitting ? "Placing order…" : needsCheck ? "Checking you're human…" : "Place order"}
        </button>
        {formError && <p className="mt-3 text-sm text-red-700" role="alert">{formError}</p>}
      </aside>

      {/* Mobile: total always visible */}
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between border-t border-ink/80 bg-paper px-4 py-3 lg:hidden">
        <span>
          <span className="block text-sm text-ink-muted">Total</span>
          <span className="text-xl font-semibold tabular-nums">{money(total)}</span>
        </span>
        <a href="#summary" className="btn-primary">Review & place order</a>
      </div>

      {/* "Did you mean...?" */}
      {suggestion && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="addr-title">
          <div className="w-full max-w-md border border-rule bg-paper p-6">
            <h2 id="addr-title" className="text-lg font-semibold">Did you mean this address?</h2>
            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-ink-muted">You entered</p>
                <p className="mt-1">{enteredAddress}<br />{form.city}, {form.state} {form.zip}</p>
              </div>
              <div>
                <p className="text-ink-muted">USPS suggests</p>
                <p className="mt-1 font-semibold">{suggestedAddress}<br />{suggestion.city}, {suggestion.state} {suggestion.zip}</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={useSuggested} disabled={submitting || needsCheck} className="btn-primary disabled:opacity-60">
                {submitting ? "Placing order…" : "Use suggested"}
              </button>
              <button type="button" onClick={() => submit({ addressConfirmed: true, usedSuggestion: false })} disabled={submitting || needsCheck} className="border border-ink px-6 py-3 font-semibold disabled:opacity-60">
                Keep mine
              </button>
            </div>
            <button type="button" onClick={() => { setSuggestion(null); setSubmitting(false); }} className="mt-4 text-sm text-ink-muted underline">
              Edit address
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function inputClass(error?: string) {
  return `mt-1 w-full border bg-paper px-3 py-2.5 text-base outline-none focus:border-accent ${error ? "border-red-700" : "border-ink/30"}`;
}

function Field({ label, error, className = "", children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-700">{error}</span>}
    </label>
  );
}
