import { uniqueSorted } from "./money";

export interface ExpenseFact {
  payerId: string;
  totalCents: number;
  shares: { userId: string; shareCents: number }[];
}

export interface SettlementFact {
  payerId: string;
  receiverId: string;
  amountCents: number;
}

export interface MemberBalance {
  userId: string;
  paidCents: number;
  shareCents: number;
  settlementsPaidCents: number;
  settlementsReceivedCents: number;
  netCents: number;
}

export interface Transfer {
  fromId: string;
  toId: string;
  amountCents: number;
}

export function computeBalances(
  memberIds: string[],
  expenses: ExpenseFact[],
  settlements: SettlementFact[],
): MemberBalance[] {
  const ids = uniqueSorted(memberIds);
  const rows = new Map<string, MemberBalance>();
  for (const userId of ids) {
    rows.set(userId, {
      userId,
      paidCents: 0,
      shareCents: 0,
      settlementsPaidCents: 0,
      settlementsReceivedCents: 0,
      netCents: 0,
    });
  }
  const touch = (userId: string) => {
    const existing = rows.get(userId);
    if (existing) return existing;
    const created: MemberBalance = {
      userId,
      paidCents: 0,
      shareCents: 0,
      settlementsPaidCents: 0,
      settlementsReceivedCents: 0,
      netCents: 0,
    };
    rows.set(userId, created);
    return created;
  };

  for (const expense of expenses) {
    touch(expense.payerId).paidCents += expense.totalCents;
    for (const share of expense.shares) touch(share.userId).shareCents += share.shareCents;
  }
  for (const settlement of settlements) {
    touch(settlement.payerId).settlementsPaidCents += settlement.amountCents;
    touch(settlement.receiverId).settlementsReceivedCents += settlement.amountCents;
  }

  for (const row of rows.values()) {
    row.netCents = row.paidCents - row.shareCents + row.settlementsPaidCents - row.settlementsReceivedCents;
  }
  return [...rows.values()].sort((a, b) => (a.userId < b.userId ? -1 : 1));
}

/** Propone transferencias que liquidan los saldos netos sin crear ni destruir dinero. */
export function simplifyDebts(nets: { userId: string; netCents: number }[]): Transfer[] {
  const creditors = nets
    .filter((row) => row.netCents > 0)
    .map((row) => ({ userId: row.userId, left: row.netCents }))
    .sort(byAmountThenId);
  const debtors = nets
    .filter((row) => row.netCents < 0)
    .map((row) => ({ userId: row.userId, left: -row.netCents }))
    .sort(byAmountThenId);
  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = Math.min(debtors[debtorIndex].left, creditors[creditorIndex].left);
    if (amount > 0) {
      transfers.push({
        fromId: debtors[debtorIndex].userId,
        toId: creditors[creditorIndex].userId,
        amountCents: amount,
      });
    }
    debtors[debtorIndex].left -= amount;
    creditors[creditorIndex].left -= amount;
    if (debtors[debtorIndex].left === 0) debtorIndex += 1;
    if (creditors[creditorIndex].left === 0) creditorIndex += 1;
  }
  return transfers;
}

export function settlementTouches(memberIds: string[], settlements: SettlementFact[]): boolean {
  const involved = new Set(memberIds);
  return settlements.some((settlement) => involved.has(settlement.payerId) || involved.has(settlement.receiverId));
}

function byAmountThenId(a: { userId: string; left: number }, b: { userId: string; left: number }): number {
  return b.left - a.left || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
}
