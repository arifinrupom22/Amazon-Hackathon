/**
 * Date keys are always *local* calendar dates (YYYY-MM-DD).
 *
 * Using `toISOString()` would shift the day for anyone east or west of UTC
 * (e.g. 00:41 in UTC+6 is still the previous day in UTC), which breaks
 * "today" on the dashboard and the dates inside generated plans.
 */

export function toDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Noon local time avoids DST edge cases when doing date arithmetic. */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function addDaysToKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function weekdayOfKey(key: string): number {
  return parseDateKey(key).getDay();
}

/** Next occurrence of a weekday (0 = Sunday), today included. */
export function nextWeekdayKey(target: number, fromKey: string = toDateKey()): string {
  const delta = (target - weekdayOfKey(fromKey) + 7) % 7;
  return addDaysToKey(fromKey, delta);
}
