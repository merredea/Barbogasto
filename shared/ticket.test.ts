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

  it("reparte el IVA entre las líneas cuando el ticket lo suma al final", () => {
    const draft = normalizeTicket({
      items: [
        { name: "Menú", quantityMillis: 1000, unitPriceCents: 333, lineCents: 333, confident: true },
        { name: "Café", quantityMillis: 1000, unitPriceCents: 667, lineCents: 667, confident: true },
      ],
      taxCents: 210,
      totalCents: 1210,
      totalConfident: true,
    });
    expect(draft.items.map((item) => item.kind)).toEqual(["item", "item"]);
    expect(draft.items.map((item) => item.lineCents)).toEqual([403, 807]);
    expect(draft.items.map((item) => item.unitPriceCents)).toEqual([403, 807]);
    expect(draft.items.every((item) => item.needsReview)).toBe(true);
    expect(draft.taxCents).toBe(210);
    expect(draft.warnings.some((warning) => warning.includes("aplicado su tipo a cada línea"))).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("no coincide"))).toBe(false);
  });

  it("respeta tipos de IVA distintos por línea cuando el ticket los muestra", () => {
    const draft = normalizeTicket({
      items: [
        { name: "Pan", quantityMillis: 1000, unitPriceCents: 1000, lineCents: 1000, taxRatePercent: 10, confident: true },
        { name: "Taladro", quantityMillis: 1000, unitPriceCents: 1000, lineCents: 1000, taxRatePercent: 21, confident: true },
      ],
      taxCents: 310,
      totalCents: 2310,
      totalConfident: true,
    });
    expect(draft.items.map((item) => item.lineCents)).toEqual([1100, 1210]);
    expect(draft.warnings.some((warning) => warning.includes("aplicado su tipo"))).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("no coincide"))).toBe(false);
  });

  it("no inventa precios con IVA cuando hay varios tipos sin identificar", () => {
    const draft = normalizeTicket({
      items: [
        { name: "Pan", lineCents: 1000, confident: true },
        { name: "Taladro", lineCents: 1000, confident: true },
      ],
      taxCents: 155,
      totalCents: 2155,
      totalConfident: true,
    });
    expect(draft.items.map((item) => item.lineCents)).toEqual([1000, 1000]);
    expect(draft.items.every((item) => item.needsReview)).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("no se puede saber el tipo"))).toBe(true);
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
