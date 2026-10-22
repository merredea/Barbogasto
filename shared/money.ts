/** Reparte céntimos enteros. Los céntimos sobrantes van a las primeras posiciones. */
export function splitEvenly(totalCents: number, parts: number): number[] {
  assertInt(totalCents, "total");
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("reparto inválido");
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / parts);
  const extra = abs % parts;
  return Array.from({ length: parts }, (_, index) => sign * (base + (index < extra ? 1 : 0)));
}

/**
 * Reparte `totalCents` en proporción a pesos enteros.
 * El resto se asigna a los mayores residuos, y a igualdad de residuo al índice menor.
 */
export function allocateByWeights(totalCents: number, weights: number[]): number[] {
  assertInt(totalCents, "total");
  if (weights.length === 0) throw new Error("reparto inválido");
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 0) throw new Error("peso inválido");
  }
  const sign = totalCents < 0 ? -1 : 1;
  const absTotal = Math.abs(totalCents);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) return splitEvenly(totalCents, weights.length);

  const bases = new Array<number>(weights.length);
  const remainders: { index: number; remainder: number }[] = [];
  let assigned = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const product = absTotal * weights[index];
    const base = Math.floor(product / weightSum);
    bases[index] = base;
    remainders.push({ index, remainder: product % weightSum });
    assigned += base;
  }
  let left = absTotal - assigned;
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; cursor < left; cursor += 1) bases[remainders[cursor].index] += 1;
  return bases.map((value) => value * sign);
}

export function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function sumCents(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export function formatCents(cents: number, currency = "EUR"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const symbol = currency === "EUR" ? "€" : currency;
  return `${sign}${grouped},${frac} ${symbol}`;
}

export function formatSignedCents(cents: number, currency = "EUR"): string {
  if (cents > 0) return `+${formatCents(cents, currency)}`;
  return formatCents(cents, currency);
}

export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function parseEurosToCents(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, "").replace("€", "");
  const match = trimmed.match(/^(-?)(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === "-" ? -cents : cents;
}

export function formatQuantity(millis: number): string {
  const sign = millis < 0 ? "-" : "";
  const abs = Math.abs(millis);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}`;
  const fracText = String(frac).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole},${fracText}`;
}

export function parseQuantityMillis(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, "");
  const match = trimmed.match(/^(\d{1,3})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const frac = (match[2] ?? "").padEnd(3, "0");
  const millis = Number(match[1]) * 1000 + Number(frac);
  if (!Number.isInteger(millis) || millis <= 0 || millis > 100_000) return null;
  return millis;
}

function assertInt(value: number, label: string): void {
  if (!Number.isInteger(value)) throw new Error(`${label} inválido`);
}
