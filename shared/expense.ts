import { allocateByWeights, splitEvenly, sumCents, uniqueSorted } from "./money";
import { addDays, isIsoDate } from "./dates";

export type SplitMode = "equal" | "items";
export type ItemKind = "item" | "tax" | "discount" | "tip" | "adjustment";
export type AdjustmentMode = "proportional" | "manual";

export interface ItemDraft {
  name: string;
  quantityMillis: number;
  unitPriceCents: number | null;
  lineCents: number;
  kind: ItemKind;
  participantIds: string[];
  needsReview: boolean;
}

export interface ExpenseDraft {
  description: string;
  merchant: string | null;
  note: string | null;
  expenseDate: string;
  currency: "EUR";
  totalCents: number;
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
  items: ItemDraft[];
  adjustmentMode: AdjustmentMode;
  manualAdjustmentCents: Record<string, number>;
}

export interface ComputedSplit {
  shares: { userId: string; shareCents: number }[];
  allocations: { itemIndex: number; userId: string; shareCents: number }[];
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const MAX_TOTAL = 10_000_000;
const KINDS = new Set<ItemKind>(["item", "tax", "discount", "tip", "adjustment"]);

export function parseExpenseInput(
  body: unknown,
  memberIds: string[],
  todayIso: string,
): ExpenseDraft {
  if (!body || typeof body !== "object") throw new InputError("El gasto no es válido.");
  const source = body as Record<string, unknown>;
  const description = cleanText(source.description, 80, "La descripción");
  if (!description) throw new InputError("Añade una descripción.");
  const merchant = optionalText(source.merchant, 80);
  const note = optionalText(source.note, 400);
  if (typeof source.expenseDate !== "string" || !isIsoDate(source.expenseDate)) {
    throw new InputError("La fecha no es válida.");
  }
  if (source.expenseDate > addDays(todayIso, 1)) throw new InputError("La fecha es demasiado futura.");
  if (source.currency !== "EUR") throw new InputError("De momento solo se pueden guardar gastos en euros.");
  const totalCents = requiredInt(source.totalCents, 0, MAX_TOTAL, "El importe");
  const members = new Set(memberIds);
  if (typeof source.payerId !== "string" || !members.has(source.payerId)) {
    throw new InputError("Elige quién ha pagado.");
  }
  if (!Array.isArray(source.participantIds) || source.participantIds.length === 0) {
    throw new InputError("Elige al menos una persona.");
  }
  const participantIds = uniqueSorted(source.participantIds.filter((id): id is string => typeof id === "string"));
  if (participantIds.length !== source.participantIds.length) throw new InputError("Hay participantes repetidos.");
  if (participantIds.some((id) => !members.has(id))) throw new InputError("Algún participante no está en el grupo.");
  if (source.splitMode !== "equal" && source.splitMode !== "items") {
    throw new InputError("Elige cómo repartir el gasto.");
  }
  const items = parseItems(source.items, participantIds, source.splitMode);
  const adjustmentMode = source.adjustmentMode === "manual" ? "manual" : "proportional";
  const manualAdjustmentCents = parseManual(source.manualAdjustmentCents, participantIds);
  const draft: ExpenseDraft = {
    description,
    merchant,
    note,
    expenseDate: source.expenseDate,
    currency: "EUR",
    totalCents,
    payerId: source.payerId,
    participantIds,
    splitMode: source.splitMode,
    items,
    adjustmentMode,
    manualAdjustmentCents,
  };
  computeSplit(draft);
  return draft;
}

export function computeSplit(draft: Pick<ExpenseDraft, "totalCents" | "participantIds" | "splitMode" | "items" | "adjustmentMode" | "manualAdjustmentCents">): ComputedSplit {
  if (draft.splitMode === "equal") {
    const parts = splitEvenly(draft.totalCents, draft.participantIds.length);
    return {
      shares: draft.participantIds.map((userId, index) => ({ userId, shareCents: parts[index] })),
      allocations: [],
    };
  }
  if (draft.items.length === 0) throw new InputError("Añade al menos un producto para repartir por líneas.");
  const allocations: ComputedSplit["allocations"] = [];
  const itemTotals = new Map<string, number>();
  for (const userId of draft.participantIds) itemTotals.set(userId, 0);
  draft.items.forEach((item, itemIndex) => {
    const ids = uniqueSorted(item.participantIds);
    if (ids.length === 0) throw new InputError(`Asigna «${item.name}» a alguien.`);
    if (ids.some((id) => !itemTotals.has(id))) throw new InputError("Una línea incluye a alguien que no participa.");
    const parts = splitEvenly(item.lineCents, ids.length);
    ids.forEach((userId, index) => {
      allocations.push({ itemIndex, userId, shareCents: parts[index] });
      itemTotals.set(userId, (itemTotals.get(userId) ?? 0) + parts[index]);
    });
  });
  const lineSum = sumCents(draft.items.map((item) => item.lineCents));
  const adjustment = draft.totalCents - lineSum;
  if (adjustment !== 0) {
    const portions =
      draft.adjustmentMode === "manual"
        ? manualPortions(draft.participantIds, draft.manualAdjustmentCents, adjustment)
        : allocateByWeights(
            adjustment,
            draft.participantIds.map((id) => Math.max(0, itemTotals.get(id) ?? 0)),
          );
    draft.participantIds.forEach((userId, index) => {
      itemTotals.set(userId, (itemTotals.get(userId) ?? 0) + portions[index]);
    });
  }
  const shares = draft.participantIds.map((userId) => ({ userId, shareCents: itemTotals.get(userId) ?? 0 }));
  if (shares.some((share) => share.shareCents < 0)) {
    throw new InputError("El reparto deja un importe negativo. Asigna el ajuste manualmente.");
  }
  if (sumCents(shares.map((share) => share.shareCents)) !== draft.totalCents) {
    throw new InputError("El reparto no cuadra con el total.");
  }
  return { shares, allocations };
}

function manualPortions(participantIds: string[], manual: Record<string, number>, adjustment: number): number[] {
  const allowed = new Set(participantIds);
  for (const userId of Object.keys(manual)) {
    if (!allowed.has(userId)) throw new InputError("El ajuste incluye a alguien que no participa.");
  }
  const portions = participantIds.map((userId) => manual[userId] ?? 0);
  if (sumCents(portions) !== adjustment) {
    throw new InputError("El ajuste manual no cuadra con la diferencia entre las líneas y el total.");
  }
  return portions;
}

function parseItems(value: unknown, participantIds: string[], mode: SplitMode): ItemDraft[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Las líneas del gasto no son válidas.");
  if (value.length > 80) throw new InputError("Hay demasiadas líneas.");
  const allowed = new Set(participantIds);
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new InputError("Hay una línea incompleta.");
    const item = entry as Record<string, unknown>;
    const name = cleanText(item.name, 80, "El producto");
    if (!name) throw new InputError("Cada línea necesita un nombre.");
    const quantityMillis = item.quantityMillis == null ? 1000 : requiredInt(item.quantityMillis, 1, 100_000, "La cantidad");
    const unitPriceCents =
      item.unitPriceCents == null ? null : requiredInt(item.unitPriceCents, -MAX_TOTAL, MAX_TOTAL, "El precio");
    const lineCents = requiredInt(item.lineCents, -MAX_TOTAL, MAX_TOTAL, "El importe de la línea");
    const kind = item.kind ?? "item";
    if (typeof kind !== "string" || !KINDS.has(kind as ItemKind)) throw new InputError("El tipo de línea no es válido.");
    const rawIds = Array.isArray(item.participantIds) ? item.participantIds : [];
    const ids = uniqueSorted(rawIds.filter((id): id is string => typeof id === "string"));
    if (mode === "items") {
      if (ids.length === 0) throw new InputError(`Asigna «${name}» a alguien.`);
      if (ids.some((id) => !allowed.has(id))) throw new InputError("Una línea incluye a alguien que no participa.");
    }
    return {
      name,
      quantityMillis,
      unitPriceCents,
      lineCents,
      kind: kind as ItemKind,
      participantIds: mode === "items" ? ids : [],
      needsReview: item.needsReview === true,
    };
  });
}

function parseManual(value: unknown, participantIds: string[]): Record<string, number> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("El ajuste no es válido.");
  const allowed = new Set(participantIds);
  const result: Record<string, number> = {};
  for (const [userId, cents] of Object.entries(value)) {
    if (!allowed.has(userId)) throw new InputError("El ajuste incluye a alguien que no participa.");
    result[userId] = requiredInt(cents, -MAX_TOTAL, MAX_TOTAL, "El ajuste");
  }
  return result;
}

function requiredInt(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`${label} no es válido.`);
  }
  return value;
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new InputError(`${label} no es válido.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) throw new InputError(`${label} es demasiado largo.`);
  return text;
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  const text = cleanText(value, max, "El texto");
  return text || null;
}
