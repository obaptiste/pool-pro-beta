/**
 * What a pool controller's own clock is set to.
 *
 * A controller writes times with no offset, like a note that says
 * "3 o'clock" without naming the city. Both paths that read those times use
 * this module, so one device gets one answer:
 *
 * - the cloud sync (api/_lib/poolControllers/hannaCloud/source.ts), which
 *   builds a DeviceClock from HANNA_CLOUD_DEVICE_TIMEZONE or
 *   HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES, and
 * - the CSV importer (hannaCsv.ts), where the operator picks it on the
 *   import screen because the browser cannot read server configuration.
 *
 * 'zone' converts per reading and follows daylight saving, for a device
 * that changes its clock with local time. 'offset' never changes, for a
 * device with no daylight-saving setting, which is most of them. Picking the
 * wrong one of the two is silent until a clock change.
 */
export type DeviceClock =
  | { kind: 'utc' }
  | { kind: 'zone'; timeZone: string }
  | { kind: 'offset'; minutes: number };

export const UTC_DEVICE_CLOCK: DeviceClock = { kind: 'utc' };

/** Largest offset from UTC any real zone uses, in minutes (UTC+14:00). */
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

// Building an Intl.DateTimeFormat is slow, and one conversion needs several
// lookups, so a three-month export on a 'zone' clock took over a second of
// blocked main thread. One formatter per zone is reused instead. The cache
// only ever holds the zones a session actually uses.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

// Minutes that `timeZone`'s local wall clock is ahead of UTC at `instantMs`.
// Derived by formatting the instant in that zone and reading the result back
// as if it were UTC -- the difference is the offset, DST included.
export function zoneOffsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  const field: Record<string, string> = {};
  for (const part of parts) field[part.type] = part.value;
  // Some engines render midnight as hour 24 under hour12:false.
  const hour = field.hour === '24' ? '00' : field.hour;
  const asIfUtc = Date.UTC(
    Number(field.year), Number(field.month) - 1, Number(field.day),
    Number(hour), Number(field.minute), Number(field.second),
  );
  return Math.round((asIfUtc - instantMs) / 60_000);
}

/**
 * Every offset at which `timeZone` really shows the wall-clock reading
 * `wallClockAsUtcMs` (the bare timestamp parsed as though it were UTC).
 * Largest offset first, which is the earlier of the instants.
 *
 * Almost always one. Two when clocks go back and an hour of local time
 * repeats; none when clocks go forward and the local time never happened.
 * Which of two to use is the caller's decision, because it needs a fact the
 * timestamp alone cannot supply (the server clock for live telemetry, the
 * row order for an export).
 */
export function wallClockOffsets(wallClockAsUtcMs: number, timeZone: string): number[] {
  // Sample a day either side so both sides of any transition are seen.
  const candidates = new Set<number>();
  for (const probe of [wallClockAsUtcMs - 86_400_000, wallClockAsUtcMs, wallClockAsUtcMs + 86_400_000]) {
    candidates.add(zoneOffsetMinutesAt(probe, timeZone));
  }
  // An offset is only real if it round-trips: the instant it implies must
  // itself sit at that offset in the zone.
  return [...candidates]
    .filter((offset) => zoneOffsetMinutesAt(wallClockAsUtcMs - offset * 60_000, timeZone) === offset)
    .sort((a, b) => b - a);
}

/**
 * True for "UTC" or a real IANA zone written Region/City.
 *
 * Intl alone is too permissive to validate with: it also accepts bare
 * abbreviations like "BST" and raw offsets like "+01:00". The first is
 * ambiguous -- British Summer Time and Bangladesh Standard Time are five
 * hours apart -- and the second is a fixed offset wearing a zone's clothes,
 * for which the 'offset' kind is the honest choice.
 */
export function isCanonicalTimeZone(zone: string): boolean {
  if (zone !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+/-]+$/.test(zone)) return false;
  try {
    // Throws RangeError on an unknown zone; no other way to check one.
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** "+01:00" for 60, "-05:30" for -330. */
export function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Minutes for a typed offset such as "+01:00", "+1" or "-5:30", or null if
 * it can't be read exactly. The sign is required so "1" is never guessed.
 */
export function parseUtcOffset(text: string): number | null {
  const m = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const mins = m[3] === undefined ? 0 : Number(m[3]);
  if (mins > 59) return null;
  const total = hours * 60 + mins;
  if (total > MAX_UTC_OFFSET_MINUTES) return null;
  return m[1] === '-' ? -total : total;
}

/** Short label for a clock, for showing the operator what was chosen. */
export function describeDeviceClock(clock: DeviceClock): string {
  if (clock.kind === 'utc') return 'UTC';
  if (clock.kind === 'zone') return clock.timeZone;
  return `UTC${offsetSuffix(clock.minutes)}`;
}

/** What the operator has entered on a form, before it is known to be valid. */
export interface DeviceClockChoice {
  kind: '' | DeviceClock['kind'];
  timeZone: string;
  offset: string;
}

/**
 * Turns a form entry into a clock, or says what is wrong with it. An
 * unanswered form is an error too: there is deliberately no default, because
 * a silent default is how the importer and the cloud sync came to disagree.
 */
export function resolveDeviceClockChoice(choice: DeviceClockChoice): { clock: DeviceClock } | { error: string } {
  if (choice.kind === 'utc') return { clock: UTC_DEVICE_CLOCK };
  if (choice.kind === 'zone') {
    const timeZone = choice.timeZone.trim();
    if (timeZone === 'UTC') return { clock: UTC_DEVICE_CLOCK };
    return isCanonicalTimeZone(timeZone)
      ? { clock: { kind: 'zone', timeZone } }
      : { error: 'Enter a time zone written like Europe/London.' };
  }
  if (choice.kind === 'offset') {
    const minutes = parseUtcOffset(choice.offset);
    return minutes === null
      ? { error: 'Enter an offset written like +01:00 or -05:00.' }
      : { clock: { kind: 'offset', minutes } };
  }
  return { error: 'Choose what the controller\'s clock is set to.' };
}
