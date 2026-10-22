import { describe, expect, it } from "vitest";
import { computeSplit } from "./expense";
import { computeBalances, settlementTouches, simplifyDebts } from "./ledger";

const ana = "ana";
const luis = "luis";
const carlos = "carlos";

describe("saldos", () => {
  it("calcula el ejemplo de 30 € pagados por Ana", () => {
    const [balanceAna, balanceCarlos, balanceLuis] = computeBalances(
      [ana, luis, carlos],
      [{ payerId: ana, totalCents: 3000, shares: [ana, luis, carlos].map((userId) => ({ userId, shareCents: 1000 })) }],
      [],
    );
    expect(balanceAna.netCents).toBe(2000);
    expect(balanceLuis.netCents).toBe(-1000);
    expect(balanceCarlos.netCents).toBe(-1000);
    expect(balanceAna.netCents + balanceLuis.netCents + balanceCarlos.netCents).toBe(0);
  });

  it("recalcula al añadir el gasto de Luis sin duplicar el anterior", () => {
    const first = [{ payerId: ana, totalCents: 3000, shares: [1000, 1000, 1000].map((shareCents, index) => ({ userId: [ana, luis, carlos][index], shareCents })) }];
    const second = {
      payerId: luis,
      totalCents: 1800,
      shares: [600, 600, 600].map((shareCents, index) => ({ userId: [ana, luis, carlos][index], shareCents })),
    };
    const balances = computeBalances([ana, luis, carlos], [...first, second], []);
    const net = Object.fromEntries(balances.map((row) => [row.userId, row.netCents]));
    expect(net).toEqual({ ana: 1400, luis: 200, carlos: -1600 });
    const replaced = computeBalances([ana, luis, carlos], [second], []);
    expect(replaced.find((row) => row.userId === ana)?.netCents).toBe(-600);
  });

  it("aplica un pago real y no lo confunde con una sugerencia", () => {
    const balances = computeBalances(
      [ana, luis, carlos],
      [{ payerId: ana, totalCents: 3000, shares: [ana, luis, carlos].map((userId) => ({ userId, shareCents: 1000 })) }],
      [{ payerId: luis, receiverId: ana, amountCents: 1000 }],
    );
    const net = Object.fromEntries(balances.map((row) => [row.userId, row.netCents]));
    expect(net).toEqual({ ana: 1000, luis: 0, carlos: -1000 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([{ fromId: carlos, toId: ana, amountCents: 1000 }]);
  });

  it("simplifica deudas conservando cada saldo", () => {
    const nets = [
      { userId: ana, netCents: 500 },
      { userId: luis, netCents: 500 },
      { userId: carlos, netCents: -1000 },
    ];
    const transfers = simplifyDebts(nets);
    expect(transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0)).toBe(1000);
    const after = new Map(nets.map((row) => [row.userId, row.netCents]));
    for (const transfer of transfers) {
      after.set(transfer.fromId, (after.get(transfer.fromId) ?? 0) + transfer.amountCents);
      after.set(transfer.toId, (after.get(transfer.toId) ?? 0) - transfer.amountCents);
    }
    expect([...after.values()]).toEqual([0, 0, 0]);
  });

  it("pide conciliación solo si el gasto toca a alguien con pagos", () => {
    const settlements = [{ payerId: luis, receiverId: ana, amountCents: 100 }];
    expect(settlementTouches([ana, carlos], settlements)).toBe(true);
    expect(settlementTouches([carlos], settlements)).toBe(false);
  });
});

describe("reparto de productos", () => {
  it("divide cada línea y cuadra con 45 €", () => {
    const split = computeSplit({
      totalCents: 4500,
      participantIds: [ana, carlos, luis],
      splitMode: "items",
      adjustmentMode: "proportional",
      manualAdjustmentCents: {},
      items: [
        { name: "Cervezas", quantityMillis: 1000, unitPriceCents: 900, lineCents: 900, kind: "item", participantIds: [ana, luis], needsReview: false },
        { name: "Hamburguesa", quantityMillis: 1000, unitPriceCents: 1400, lineCents: 1400, kind: "item", participantIds: [ana], needsReview: false },
        { name: "Pizza", quantityMillis: 1000, unitPriceCents: 1800, lineCents: 1800, kind: "item", participantIds: [luis, carlos], needsReview: false },
        { name: "Café", quantityMillis: 1000, unitPriceCents: 400, lineCents: 400, kind: "item", participantIds: [carlos], needsReview: false },
      ],
    });
    const shares = Object.fromEntries(split.shares.map((share) => [share.userId, share.shareCents]));
    expect(shares).toEqual({ ana: 1850, luis: 1350, carlos: 1300 });
  });

  it("reparte un impuesto proporcional y deja el total exacto", () => {
    const split = computeSplit({
      totalCents: 1100,
      participantIds: [ana, luis],
      splitMode: "items",
      adjustmentMode: "proportional",
      manualAdjustmentCents: {},
      items: [
        { name: "Café", quantityMillis: 1000, unitPriceCents: null, lineCents: 200, kind: "item", participantIds: [ana], needsReview: false },
        { name: "Tarta", quantityMillis: 1000, unitPriceCents: null, lineCents: 800, kind: "item", participantIds: [luis], needsReview: false },
      ],
    });
    const shares = Object.fromEntries(split.shares.map((share) => [share.userId, share.shareCents]));
    expect(shares.ana + shares.luis).toBe(1100);
    expect(shares.ana).toBe(220);
    expect(shares.luis).toBe(880);
  });
});
