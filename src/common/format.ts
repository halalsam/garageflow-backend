// Money + date formatting. All date strings are produced in UTC so historical
// fixtures render deterministically regardless of the server timezone.

// ── Money ───────────────────────────────────────────────────────────────────
// DB stores Int paise. DTOs accept rupees; serializers emit rupees (numbers).
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => Math.round(paise) / 100;

// ── Dates (India display strings, computed in UTC) ───────────────────────────
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const asDate = (d: Date | string): Date => (d instanceof Date ? d : new Date(d));

/** "26 Jun 2026" */
export const formatDate = (d: Date | string): string => {
  const dt = asDate(d);
  return `${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
};

/** "8:30 AM" */
export const formatTime = (d: Date | string): string => {
  const dt = asDate(d);
  const h24 = dt.getUTCHours();
  const m = dt.getUTCMinutes();
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
};

/** "12m ago" / "1h ago" / "3d ago" / "just now" */
export const relativeTime = (d: Date | string, now: Date = new Date()): string => {
  const diffMs = now.getTime() - asDate(d).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

/** "June 2026" — accepts a Date or a "YYYY-MM" string. */
export const monthLabel = (input: Date | string): string => {
  if (typeof input === 'string' && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split('-').map(Number);
    return `${MONTHS_LONG[m - 1]} ${y}`;
  }
  const dt = asDate(input);
  return `${MONTHS_LONG[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
};

/** ISO date "2026-06-26" (UTC, date-only). */
export const isoDate = (d: Date | string): string => asDate(d).toISOString().slice(0, 10);

/** durationMs → "0:24" (m:ss). */
export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Fallback initials from a full name: "Rakesh Kumar" → "RK". */
export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Short party name: "Rakesh Kumar" → "Rakesh K." */
export const shortName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};
