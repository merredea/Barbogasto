export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isoDateInTimeZone(date: Date, timeZone: string): string {
  const parts = civilParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function monthPeriod(date: Date, timeZone: string): string {
  const parts = civilParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}`;
}

export function isLastDayOfMonth(date: Date, timeZone: string): boolean {
  const parts = civilParts(date, timeZone);
  return parts.day === lastDayOfMonth(parts.year, parts.month);
}

export const REMINDER_TEXT =
  "Fin de mes: revisa los gastos compartidos y salda tus cuentas pendientes.";

/** Periodo YYYY-MM que toca recordar, o null si hoy no corresponde. */
export function reminderPeriodIfDue(now: Date, timeZone: string): string | null {
  if (isLastDayOfMonth(now, timeZone)) return monthPeriod(now, timeZone);
  const today = isoDateInTimeZone(now, timeZone);
  for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
    const past = addDays(today, -daysAgo);
    const [year, month, day] = past.split("-").map(Number);
    if (day === lastDayOfMonth(year, month)) return `${year}-${pad(month)}`;
  }
  return null;
}

function civilParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
