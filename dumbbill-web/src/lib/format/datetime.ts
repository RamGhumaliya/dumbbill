/**
 * Dates and times shown to people. The API sends ISO-8601 UTC ("2026-10-18T09:30:00.000Z"); people read them in
 * Indian time (Asia/Kolkata) and in the Indian style, for example "18 Oct 2026, 3:00 pm". Done here once so every
 * screen shows times the same way, and a time is never shown in the viewer's accidental time zone.
 */
const formatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** An ISO date-time string as "18 Oct 2026, 3:00 pm" in Indian time. Returns the input unchanged if it is not a date. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatter.format(date);
}
