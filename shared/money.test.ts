import { describe, expect, it } from "vitest";
import sqlText from "../migrations/0001_init.sql?raw";
import { allocateByWeights, formatCents, parseEurosToCents, splitEvenly, sumCents } from "./money";

describe("céntimos", () => {
  it("reparte 100 céntimos entre 3 sin perder ni ganar", () => {
    const parts = splitEvenly(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(sumCents(parts)).toBe(100);
  });

  it("reparte descuentos negativos con la misma regla", () => {
    expect(sumCents(splitEvenly(-100, 3))).toBe(-100);
    expect(splitEvenly(-100, 3)).toEqual([-34, -33, -33]);
  });

  it("asigna el resto proporcional con enteros", () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(1, [2, 1])).toEqual([1, 0]);
    expect(sumCents(allocateByWeights(2, [1, 1]))).toBe(2);
  });

  it("conserva el total en repartos aleatorios", () => {
    let seed = 99;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let round = 0; round < 200; round += 1) {
      const total = (next() % 50_000) - 5_000;
      const weights = [1, 2, 3].map(() => next() % 40);
      expect(sumCents(allocateByWeights(total, weights))).toBe(total);
      expect(sumCents(splitEvenly(total, 1 + (next() % 7)))).toBe(total);
    }
  });

  it("formatea y lee euros sin usar el valor flotante como cálculo", () => {
    expect(formatCents(123456)).toBe("1.234,56 €");
    expect(formatCents(-1050)).toBe("-10,50 €");
    expect(parseEurosToCents("1.234,56")).toBeNull();
    expect(parseEurosToCents("12,5")).toBe(1250);
    expect(parseEurosToCents("12.50")).toBe(1250);
    expect(parseEurosToCents("-0,01")).toBe(-1);
  });
});

describe("esquema", () => {
  it("no reserva sitio para fotografías", () => {
    const sql = sqlText.toLowerCase();
    for (const table of [
      "users",
      "group_members",
      "invitations",
      "expenses",
      "expense_participants",
      "expense_items",
      "expense_item_allocations",
      "settlements",
      "push_subscriptions",
      "notification_logs",
    ]) {
      expect(sql).toContain(`create table ${table}`);
    }
    expect(sql).not.toContain("blob");
    expect(sql).not.toContain("image");
    expect(sql).not.toContain("photo");
    expect(sql).not.toContain("base64");
  });
});
