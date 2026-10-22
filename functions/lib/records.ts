import { computeSplit, parseExpenseInput, type ExpenseDraft } from "../../shared/expense";
import { computeBalances, settlementTouches, simplifyDebts, type SettlementFact } from "../../shared/ledger";
import { sha256Text } from "../../shared/password";
import { isIsoDate } from "../../shared/dates";
import { todayFor } from "./auth";
import { ApiError, type AppCtx, json, requireUser, withIdempotency } from "./http";

const MAX_TOTAL = 10_000_000;

export async function listExpenses(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const limit = Math.min(10000, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 200) || 200));
  const rows = await ctx.db
    .prepare(
      `SELECT e.id, e.description, e.merchant, e.note, e.expense_date, e.currency, e.total_cents, e.payer_id,
              e.split_mode, e.created_at, e.updated_at, u.name AS payer_name
       FROM expenses e
       JOIN users u ON u.id = e.payer_id
       WHERE e.group_id = ?
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT ?`,
    )
    .bind(user.groupId, limit)
    .all<ExpenseRow>();
  const participants = await participantsFor(ctx, rows.results.map((row) => row.id));
  return json({ expenses: rows.results.map((row) => serializeExpense(row, participants.get(row.id) ?? [])) });
}

export async function getExpense(ctx: AppCtx, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(ctx);
  const loaded = await loadExpense(ctx, user.groupId, params.id);
  if (!loaded) throw new ApiError(404, "gasto", "No se ha encontrado el gasto.");
  return json(loaded);
}

export async function createExpense(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  return withIdempotency(ctx.db, user.id, ctx.request, await sha256Text(ctx.rawBody), async () => {
    const draft = await parseForGroup(ctx, user.groupId, user);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await writeExpense(ctx, user.groupId, user.id, id, draft, now, now);
    const loaded = await loadExpense(ctx, user.groupId, id);
    return json(loaded, 201);
  });
}

export async function updateExpense(ctx: AppCtx, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(ctx);
  const current = await loadExpense(ctx, user.groupId, params.id);
  if (!current) throw new ApiError(404, "gasto", "No se ha encontrado el gasto.");
  const draft = await parseForGroup(ctx, user.groupId, user);
  const reconcile = objectBody(ctx.body).reconcile === true;
  const affected = [current.payerId, ...current.participants.map((person) => person.userId), draft.payerId, ...draft.participantIds];
  if (!reconcile && (await affectsSettlements(ctx, user.groupId, affected))) {
    throw new ApiError(409, "conciliacion", "Hay pagos anotados de estas personas. Si continúas, los saldos se recalcularán y esos pagos se conservan.");
  }
  const now = new Date().toISOString();
  await ctx.db.batch([
    ctx.db.prepare(`DELETE FROM expense_items WHERE expense_id = ?`).bind(params.id),
    ctx.db.prepare(`DELETE FROM expense_participants WHERE expense_id = ?`).bind(params.id),
    ctx.db
      .prepare(
        `UPDATE expenses
         SET description = ?, merchant = ?, note = ?, expense_date = ?, currency = ?, total_cents = ?, payer_id = ?, split_mode = ?, updated_at = ?
         WHERE id = ? AND group_id = ?`,
      )
      .bind(draft.description, draft.merchant, draft.note, draft.expenseDate, draft.currency, draft.totalCents, draft.payerId, draft.splitMode, now, params.id, user.groupId),
    ...insertChildren(ctx, params.id, draft),
  ]);
  return json(await loadExpense(ctx, user.groupId, params.id));
}

export async function deleteExpense(ctx: AppCtx, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(ctx);
  const current = await loadExpense(ctx, user.groupId, params.id);
  if (!current) throw new ApiError(404, "gasto", "No se ha encontrado el gasto.");
  const reconcile = ctx.url.searchParams.get("reconcile") === "1";
  const affected = [current.payerId, ...current.participants.map((person) => person.userId)];
  if (!reconcile && (await affectsSettlements(ctx, user.groupId, affected))) {
    throw new ApiError(409, "conciliacion", "Hay pagos anotados de estas personas. Si continúas, los saldos se recalcularán y esos pagos se conservan.");
  }
  await ctx.db.prepare(`DELETE FROM expenses WHERE id = ? AND group_id = ?`).bind(params.id, user.groupId).run();
  return json({ ok: true });
}

export async function balances(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const members = await memberRows(ctx, user.groupId);
  const expenses = await ctx.db
    .prepare(`SELECT id, payer_id, total_cents FROM expenses WHERE group_id = ?`)
    .bind(user.groupId)
    .all<{ id: string; payer_id: string; total_cents: number }>();
  const shares = await ctx.db
    .prepare(
      `SELECT ep.expense_id, ep.user_id, ep.share_cents
       FROM expense_participants ep
       JOIN expenses e ON e.id = ep.expense_id
       WHERE e.group_id = ?`,
    )
    .bind(user.groupId)
    .all<{ expense_id: string; user_id: string; share_cents: number }>();
  const settlements = await ctx.db
    .prepare(
      `SELECT s.id, s.payer_id, s.receiver_id, s.amount_cents, s.paid_on, s.note, s.created_at,
              payer.name AS payer_name, receiver.name AS receiver_name
       FROM settlements s
       JOIN users payer ON payer.id = s.payer_id
       JOIN users receiver ON receiver.id = s.receiver_id
       WHERE s.group_id = ?
       ORDER BY s.paid_on DESC, s.created_at DESC`,
    )
    .bind(user.groupId)
    .all<SettlementRow>();
  const sharesByExpense = new Map<string, { userId: string; shareCents: number }[]>();
  for (const share of shares.results) {
    const list = sharesByExpense.get(share.expense_id) ?? [];
    list.push({ userId: share.user_id, shareCents: share.share_cents });
    sharesByExpense.set(share.expense_id, list);
  }
  const computed = computeBalances(
    members.map((member) => member.id),
    expenses.results.map((expense) => ({
      payerId: expense.payer_id,
      totalCents: expense.total_cents,
      shares: sharesByExpense.get(expense.id) ?? [],
    })),
    settlements.results.map((settlement) => ({
      payerId: settlement.payer_id,
      receiverId: settlement.receiver_id,
      amountCents: settlement.amount_cents,
    })),
  );
  const names = new Map(members.map((member) => [member.id, member.name]));
  const rows = computed.map((row) => ({ ...row, name: names.get(row.userId) ?? "Miembro" }));
  const transfers = simplifyDebts(rows).map((transfer) => ({
    ...transfer,
    fromName: names.get(transfer.fromId) ?? "Miembro",
    toName: names.get(transfer.toId) ?? "Miembro",
  }));
  return json({
    currency: user.currency,
    members: rows,
    transfers,
    settlements: settlements.results.map((settlement) => ({
      id: settlement.id,
      payerId: settlement.payer_id,
      payerName: settlement.payer_name,
      receiverId: settlement.receiver_id,
      receiverName: settlement.receiver_name,
      amountCents: settlement.amount_cents,
      paidOn: settlement.paid_on,
      note: settlement.note,
      createdAt: settlement.created_at,
    })),
  });
}

export async function createSettlement(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  return withIdempotency(ctx.db, user.id, ctx.request, await sha256Text(ctx.rawBody), async () => {
    const body = objectBody(ctx.body);
    const members = new Set((await memberRows(ctx, user.groupId)).map((member) => member.id));
    const payerId = typeof body.payerId === "string" ? body.payerId : "";
    const receiverId = typeof body.receiverId === "string" ? body.receiverId : "";
    if (!members.has(payerId) || !members.has(receiverId) || payerId === receiverId) {
      throw new ApiError(400, "datos", "Elige quién paga y quién recibe.");
    }
    if (typeof body.amountCents !== "number" || !Number.isInteger(body.amountCents) || body.amountCents < 1 || body.amountCents > MAX_TOTAL) {
      throw new ApiError(400, "datos", "El importe del pago no es válido.");
    }
    if (typeof body.paidOn !== "string" || !isIsoDate(body.paidOn)) throw new ApiError(400, "datos", "La fecha del pago no es válida.");
    const note = body.note == null || body.note === "" ? null : cleanNote(body.note);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await ctx.db
      .prepare(
        `INSERT INTO settlements (id, group_id, payer_id, receiver_id, amount_cents, paid_on, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, user.groupId, payerId, receiverId, body.amountCents, body.paidOn, note, user.id, now)
      .run();
    return json({ id }, 201);
  });
}

export async function deleteSettlement(ctx: AppCtx, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(ctx);
  const result = await ctx.db.prepare(`DELETE FROM settlements WHERE id = ? AND group_id = ?`).bind(params.id, user.groupId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new ApiError(404, "pago", "No se ha encontrado el pago.");
  return json({ ok: true });
}

async function parseForGroup(ctx: AppCtx, groupId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const members = await memberRows(ctx, groupId);
  return parseExpenseInput(ctx.body, members.map((member) => member.id), todayFor(user));
}

async function writeExpense(ctx: AppCtx, groupId: string, createdBy: string, id: string, draft: ExpenseDraft, createdAt: string, updatedAt: string) {
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO expenses (
           id, group_id, description, merchant, note, expense_date, currency, total_cents, payer_id, split_mode, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, groupId, draft.description, draft.merchant, draft.note, draft.expenseDate, draft.currency, draft.totalCents, draft.payerId, draft.splitMode, createdBy, createdAt, updatedAt),
    ...insertChildren(ctx, id, draft),
  ]);
}

function insertChildren(ctx: AppCtx, expenseId: string, draft: Awaited<ReturnType<typeof parseForGroup>>) {
  const split = computeSplit(draft);
  const statements = split.shares.map((share) =>
    ctx.db
      .prepare(`INSERT INTO expense_participants (expense_id, user_id, share_cents) VALUES (?, ?, ?)`)
      .bind(expenseId, share.userId, share.shareCents),
  );
  const itemIds = draft.items.map(() => crypto.randomUUID());
  draft.items.forEach((item, index) => {
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO expense_items (id, expense_id, position, name, quantity_millis, unit_price_cents, line_cents, kind, needs_review)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(itemIds[index], expenseId, index, item.name, item.quantityMillis, item.unitPriceCents, item.lineCents, item.kind, item.needsReview ? 1 : 0),
    );
  });
  for (const allocation of split.allocations) {
    statements.push(
      ctx.db
        .prepare(`INSERT INTO expense_item_allocations (item_id, user_id, share_cents) VALUES (?, ?, ?)`)
        .bind(itemIds[allocation.itemIndex], allocation.userId, allocation.shareCents),
    );
  }
  return statements;
}

async function loadExpense(ctx: AppCtx, groupId: string, id: string) {
  const row = await ctx.db
    .prepare(
      `SELECT e.id, e.description, e.merchant, e.note, e.expense_date, e.currency, e.total_cents, e.payer_id,
              e.split_mode, e.created_at, e.updated_at, u.name AS payer_name
       FROM expenses e
       JOIN users u ON u.id = e.payer_id
       WHERE e.id = ? AND e.group_id = ?`,
    )
    .bind(id, groupId)
    .first<ExpenseRow>();
  if (!row) return null;
  const participants = await participantsFor(ctx, [id]);
  const items = await ctx.db
    .prepare(
      `SELECT id, position, name, quantity_millis, unit_price_cents, line_cents, kind, needs_review
       FROM expense_items WHERE expense_id = ? ORDER BY position`,
    )
    .bind(id)
    .all<ItemRow>();
  const itemIds = items.results.map((item) => item.id);
  const allocations = new Map<string, { userId: string; shareCents: number }[]>();
  if (itemIds.length) {
    const marks = itemIds.map(() => "?").join(",");
    const rows = await ctx.db
      .prepare(`SELECT item_id, user_id, share_cents FROM expense_item_allocations WHERE item_id IN (${marks})`)
      .bind(...itemIds)
      .all<{ item_id: string; user_id: string; share_cents: number }>();
    for (const allocation of rows.results) {
      const list = allocations.get(allocation.item_id) ?? [];
      list.push({ userId: allocation.user_id, shareCents: allocation.share_cents });
      allocations.set(allocation.item_id, list);
    }
  }
  return {
    ...serializeExpense(row, participants.get(id) ?? []),
    items: items.results.map((item) => ({
      id: item.id,
      name: item.name,
      quantityMillis: item.quantity_millis,
      unitPriceCents: item.unit_price_cents,
      lineCents: item.line_cents,
      kind: item.kind,
      needsReview: item.needs_review === 1,
      allocations: allocations.get(item.id) ?? [],
    })),
  };
}

async function affectsSettlements(ctx: AppCtx, groupId: string, memberIds: string[]): Promise<boolean> {
  const rows = await ctx.db
    .prepare(`SELECT payer_id, receiver_id, amount_cents FROM settlements WHERE group_id = ?`)
    .bind(groupId)
    .all<{ payer_id: string; receiver_id: string; amount_cents: number }>();
  const facts: SettlementFact[] = rows.results.map((row) => ({
    payerId: row.payer_id,
    receiverId: row.receiver_id,
    amountCents: row.amount_cents,
  }));
  return settlementTouches(memberIds, facts);
}

async function participantsFor(ctx: AppCtx, expenseIds: string[]) {
  const grouped = new Map<string, { userId: string; name: string; shareCents: number }[]>();
  if (expenseIds.length === 0) return grouped;
  const marks = expenseIds.map(() => "?").join(",");
  const rows = await ctx.db
    .prepare(
      `SELECT ep.expense_id, ep.user_id, ep.share_cents, u.name
       FROM expense_participants ep
       JOIN users u ON u.id = ep.user_id
       WHERE ep.expense_id IN (${marks})
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(...expenseIds)
    .all<{ expense_id: string; user_id: string; share_cents: number; name: string }>();
  for (const row of rows.results) {
    const list = grouped.get(row.expense_id) ?? [];
    list.push({ userId: row.user_id, name: row.name, shareCents: row.share_cents });
    grouped.set(row.expense_id, list);
  }
  return grouped;
}

async function memberRows(ctx: AppCtx, groupId: string) {
  const rows = await ctx.db
    .prepare(
      `SELECT u.id, u.name, u.email, gm.role
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(groupId)
    .all<{ id: string; name: string; email: string; role: "owner" | "member" }>();
  return rows.results;
}

function serializeExpense(row: ExpenseRow, participants: { userId: string; name: string; shareCents: number }[]) {
  return {
    id: row.id,
    description: row.description,
    merchant: row.merchant,
    note: row.note,
    expenseDate: row.expense_date,
    currency: row.currency,
    totalCents: row.total_cents,
    payerId: row.payer_id,
    payerName: row.payer_name,
    splitMode: row.split_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants,
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "datos", "La solicitud no es válida.");
  return body as Record<string, unknown>;
}

function cleanNote(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "datos", "La nota no es válida.");
  const note = value.trim();
  if (note.length > 400) throw new ApiError(400, "datos", "La nota es demasiado larga.");
  return note;
}

interface ExpenseRow {
  id: string;
  description: string;
  merchant: string | null;
  note: string | null;
  expense_date: string;
  currency: string;
  total_cents: number;
  payer_id: string;
  payer_name: string;
  split_mode: "equal" | "items";
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  position: number;
  name: string;
  quantity_millis: number;
  unit_price_cents: number | null;
  line_cents: number;
  kind: string;
  needs_review: number;
}

interface SettlementRow {
  id: string;
  payer_id: string;
  receiver_id: string;
  amount_cents: number;
  paid_on: string;
  note: string | null;
  created_at: string;
  payer_name: string;
  receiver_name: string;
}
