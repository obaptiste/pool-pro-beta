// `Date.parse` (and therefore `new Date(str)`) silently normalizes
// calendar-invalid dates instead of rejecting them -- `new Date('2026-02-30')`
// becomes March 2nd rather than throwing. Any caller that needs to reject a
// bad-but-parseable string (not just guess "now") needs this explicit check
// in addition to parseability. Shared by the MCP server's date-range
// validation (api/_lib/mcp/server.ts) and the Hanna Cloud pool-controller
// sync's timestamp validation (api/_lib/poolControllers/hannaCloud/source.ts).
export function isValidCalendarDateTime(
  year: number,
  month: number,
  day: number,
  hour?: number,
  minute?: number,
  second?: number,
): boolean {
  if (month < 1 || month > 12) return false;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;
  if (hour != null && (hour > 23 || (minute ?? 0) > 59 || (second ?? 0) > 59)) return false;
  return true;
}
