import { isIsoDate } from "./dates";
import type { ItemKind } from "./expense";

export interface TicketLine {
  name: string;
  quantityMillis: number | null;
  unitPriceCents: number | null;
  lineCents: number | null;
  kind: ItemKind;
  needsReview: boolean;
}

export interface TicketDraft {
  merchant: string | null;
  merchantNeedsReview: boolean;
  date: string | null;
  dateNeedsReview: boolean;
  currency: string | null;
  currencyNeedsReview: boolean;
  items: TicketLine[];
  subtotalCents: number | null;
  taxCents: number | null;
  discountCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
  totalNeedsReview: boolean;
  warnings: string[];
}

const MAX_CENTS = 10_000_000;

/** Conserva solo campos previstos y marca lo que no se puede leer. No rellena huecos. */
export function normalizeTicket(raw: unknown): TicketDraft {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const warnings: string[] = [];
  const unreadable = Array.isArray(source.unreadable)
    ? source.unreadable.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, 160)).slice(0, 20)
    : [];
  warnings.push(...unreadable);

  const merchant = shortText(source.merchant);
  const date = typeof source.date === "string" && isIsoDate(source.date) ? source.date : null;
  if (source.date != null && date == null) warnings.push("La fecha del ticket no se ha podido leer.");
  const currency = typeof source.currency === "string" && /^[A-Z]{3}$/.test(source.currency) ? source.currency : null;
  if (source.currency != null && currency == null) warnings.push("La moneda del ticket no se ha podido leer.");
  if (currency && currency !== "EUR") warnings.push("El ticket no está en euros. Escribe el importe en euros antes de guardar.");

  const items: TicketLine[] = [];
  if (Array.isArray(source.items)) {
    for (const entry of source.items.slice(0, 80)) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const name = shortText(item.name);
      if (!name) continue;
      const line = readCents(item.lineCents);
      const unit = readCents(item.unitPriceCents);
      const quantity = readQuantity(item.quantityMillis);
      const needsReview = item.confident === false || line.review || unit.review || quantity.review;
      if (line.review || unit.review || quantity.review) warnings.push(`Revisa «${name}».`);
      items.push({
        name,
        quantityMillis: quantity.value,
        unitPriceCents: unit.value,
        lineCents: line.value,
        kind: "item",
        needsReview,
      });
    }
  }

  const subtotal = readCents(source.subtotalCents);
  const tax = readCents(source.taxCents);
  const discount = readCents(source.discountCents);
  const tip = readCents(source.tipCents);
  const total = readCents(source.totalCents);
  pushMoneyLine(items, "Impuestos", tax.value, "tax", tax.review);
  if (discount.value != null && discount.value !== 0) {
    pushMoneyLine(items, "Descuento", -Math.abs(discount.value), "discount", discount.review);
  }
  pushMoneyLine(items, "Propina", tip.value, "tip", tip.review);

  const knownLines = items.every((item) => item.lineCents != null);
  if (total.value != null && knownLines && items.length > 0) {
    const sum = items.reduce((acc, item) => acc + (item.lineCents ?? 0), 0);
    if (sum !== total.value) warnings.push("La suma de las líneas no coincide con el total. Revísalo.");
  }
  if (total.value == null) warnings.push("No se ha leído el total. Escríbelo antes de guardar.");

  return {
    merchant,
    merchantNeedsReview: !merchant || source.merchantConfident === false,
    date,
    dateNeedsReview: !date || source.dateConfident === false,
    currency,
    currencyNeedsReview: !currency || currency !== "EUR" || source.currencyConfident === false,
    items,
    subtotalCents: subtotal.value,
    taxCents: tax.value,
    discountCents: discount.value,
    tipCents: tip.value,
    totalCents: total.value,
    totalNeedsReview: total.value == null || total.review || source.totalConfident === false,
    warnings: [...new Set(warnings)],
  };
}

function pushMoneyLine(items: TicketLine[], name: string, cents: number | null, kind: ItemKind, review: boolean): void {
  if (cents == null || cents === 0) return;
  items.push({
    name,
    quantityMillis: 1000,
    unitPriceCents: cents,
    lineCents: cents,
    kind,
    needsReview: review,
  });
}

function readCents(value: unknown): { value: number | null; review: boolean } {
  if (value == null || value === "") return { value: null, review: false };
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_CENTS) {
    return { value, review: false };
  }
  return { value: null, review: true };
}

function readQuantity(value: unknown): { value: number | null; review: boolean } {
  if (value == null || value === "") return { value: null, review: false };
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000) {
    return { value, review: false };
  }
  return { value: null, review: true };
}

function shortText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > 80) return text ? text.slice(0, 80) : null;
  return text;
}
