import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { normalizeTicket } from "./ticket";
import { decryptWebPush, encryptWebPush, generateSubscriptionKeys } from "./webpush";

describe("ticket", () => {
  it("no inventa campos ausentes y marca el total ilegible", () => {
    const draft = normalizeTicket({
      merchant: "Bar Norte",
      merchantConfident: true,
      date: "32-13-2026",
      dateConfident: true,
      currency: "EUR",
      currencyConfident: true,
      items: [{ name: "Caña", quantityMillis: 2000, unitPriceCents: 250, lineCents: 500, confident: true }],
      totalCents: null,
      totalConfident: false,
      unreadable: ["total"],
    });
    expect(draft.merchant).toBe("Bar Norte");
    expect(draft.date).toBeNull();
    expect(draft.dateNeedsReview).toBe(true);
    expect(draft.totalCents).toBeNull();
    expect(draft.warnings).toContain("total");
    expect(draft.items[0].lineCents).toBe(500);
  });

  it("convierte los descuentos en líneas y avisa si no cuadran", () => {
    const draft = normalizeTicket({
      items: [{ name: "Menú", lineCents: 1000, confident: true }],
      taxCents: 210,
      discountCents: 100,
      totalCents: 2000,
      totalConfident: true,
      currency: "USD",
    });
    expect(draft.items.map((item) => item.lineCents)).toEqual([1000, -100]);
    expect(draft.currencyNeedsReview).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("no coincide"))).toBe(true);
  });

  it("no suma el IVA cuando ya viene incluido en los precios", () => {
    const draft = normalizeTicket({
      items: [
        { name: "Caña", quantityMillis: 2000, unitPriceCents: 250, lineCents: 500, confident: true },
        { name: "Pintxo", quantityMillis: 1000, unitPriceCents: 350, lineCents: 350, confident: true },
      ],
      taxCents: 73,
      totalCents: 850,
      totalConfident: true,
    });
    expect(draft.items.map((item) => item.name)).toEqual(["Caña", "Pintxo"]);
    expect(draft.items.every((item) => item.kind === "item")).toBe(true);
    expect(draft.taxCents).toBe(73);
    expect(draft.warnings.some((warning) => warning.includes("no coincide"))).toBe(false);
  });

  it("no crea línea de impuestos aunque el ticket sume el IVA al final", () => {
    const draft = normalizeTicket({
      items: [{ name: "Menú", lineCents: 1000, confident: true }],
      taxCents: 210,
      totalCents: 1210,
      totalConfident: true,
    });
    expect(draft.items.map((item) => item.kind)).toEqual(["item"]);
    expect(draft.taxCents).toBe(210);
    expect(draft.warnings.some((warning) => warning.includes("no coincide"))).toBe(true);
  });

  it("descarta importes que no sean céntimos enteros", () => {
    const draft = normalizeTicket({ items: [{ name: "Café", lineCents: 1.5, confident: true }], totalCents: 150 });
    expect(draft.items[0].lineCents).toBeNull();
    expect(draft.items[0].needsReview).toBe(true);
    expect(draft.totalCents).toBe(150);
  });
});

describe("contraseñas", () => {
  it("verifica el hash y rechaza otra contraseña", async () => {
    const stored = await hashPassword("clave-segura-1");
    expect(await verifyPassword("clave-segura-1", stored)).toBe(true);
    expect(await verifyPassword("clave-segura-2", stored)).toBe(false);
  });
});

describe("web push", () => {
  it("descifra lo que acaba de cifrar", async () => {
    const keys = await generateSubscriptionKeys();
    const payload = new TextEncoder().encode("hola");
    const encrypted = await encryptWebPush(payload, { p256dh: keys.publicRaw, auth: keys.auth });
    const decrypted = await decryptWebPush(encrypted, keys.privatePkcs8, keys.auth);
    expect(new TextDecoder().decode(decrypted)).toBe("hola");
  });
});
