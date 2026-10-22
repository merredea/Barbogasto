import { describe, expect, it } from "vitest";
import { isLastDayOfMonth, lastDayOfMonth, reminderPeriodIfDue } from "./dates";

const madrid = "Europe/Madrid";

describe("último día del mes", () => {
  it("conoce febrero, los bisiestos y los siglos", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("evalúa el día civil en Madrid, no la fecha UTC", () => {
    expect(isLastDayOfMonth(new Date("2026-02-28T07:00:00Z"), madrid)).toBe(true);
    expect(isLastDayOfMonth(new Date("2026-02-28T23:30:00Z"), madrid)).toBe(false);
    expect(isLastDayOfMonth(new Date("2024-02-28T12:00:00Z"), madrid)).toBe(false);
    expect(isLastDayOfMonth(new Date("2024-02-29T07:00:00Z"), madrid)).toBe(true);
    expect(isLastDayOfMonth(new Date("2026-03-31T07:00:00Z"), madrid)).toBe(true);
    expect(isLastDayOfMonth(new Date("2026-03-31T22:30:00Z"), madrid)).toBe(false);
  });

  it("muestra el aviso el último día y hasta siete días después", () => {
    expect(reminderPeriodIfDue(new Date("2026-02-28T07:00:00Z"), madrid)).toBe("2026-02");
    expect(reminderPeriodIfDue(new Date("2024-03-01T12:00:00Z"), madrid)).toBe("2024-02");
    expect(reminderPeriodIfDue(new Date("2026-03-07T12:00:00Z"), madrid)).toBe("2026-02");
    expect(reminderPeriodIfDue(new Date("2026-03-08T12:00:00Z"), madrid)).toBeNull();
    expect(reminderPeriodIfDue(new Date("2026-04-15T12:00:00Z"), madrid)).toBeNull();
  });
});
