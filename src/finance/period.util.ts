// Period math for the derived finance reports. All ranges are computed in UTC
// (half-open [start, end)) so figures are deterministic across timezones and
// match the UTC date strings the serializers emit.

export type Range = { start: Date; end: Date };

/** Month range from "YYYY-MM" (defaults to the current UTC month). */
export const monthRange = (month?: string, now: Date = new Date()): Range => {
  let y: number;
  let m: number; // 1-12
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    [y, m] = month.split('-').map(Number);
  } else {
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  }
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
};

/** Day range from "YYYY-MM-DD" (defaults to the current UTC day). */
export const dayRange = (day?: string, now: Date = new Date()): Range => {
  let y: number;
  let m: number;
  let d: number;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    [y, m, d] = day.split('-').map(Number);
    m -= 1;
  } else {
    y = now.getUTCFullYear();
    m = now.getUTCMonth();
    d = now.getUTCDate();
  }
  const start = new Date(Date.UTC(y, m, d));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

/** Monday→Monday range for the week containing `now` (UTC). */
export const weekRange = (now: Date = new Date()): Range => {
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
};

/** "YYYY-MM" for a date (UTC). */
export const monthKey = (d: Date = new Date()): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
