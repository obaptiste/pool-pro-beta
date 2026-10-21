import { isValidCalendarDateTime } from '../../isoDate.js';
import type { PoolControllerReading, PoolControllerSource } from '../types.js';
import { HannaCloudClient, HannaCloudError, type HannaReadingParameter } from './client.js';
import { getImpossibleValueError, type NumericReadingField } from '../../../../src/lib/readingValidation.js';

// Only a real number or a non-blank numeric string counts as a measurement.
// `Number(value)` alone isn't enough: JS coerces '', '   ', false, and [] to
// 0 rather than NaN, which would otherwise persist a fabricated 0 pH/ORP/
// temperature reading (potentially triggering a false critical alert) any
// time Hanna represents an unavailable parameter as blank instead of null.
function findParameterNumber(parameters: HannaReadingParameter[], name: string): number | null {
  const value = parameters.find((p) => p.name === name)?.value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// Rejects a finite-but-physically-impossible value the same way as an
// unparseable one -- a hardware error sentinel (e.g. temperature: -999)
// should never reach Firestore as a real Reading. Deliberately uses
// getImpossibleValueError, not getHardValidationError: the latter's min/max
// bounds are the manual entry form's typo-catching plausibility ceiling,
// and would reject a genuine extreme ORP or pH incident value.
// AGENTS.md's "never block low or high ORP" / "do not reject high pH, low
// ORP... or other abnormal but possible readings" is a project-wide
// validation posture, not one scoped to a particular write path -- the
// same reason getImpossibleValueError already skips ph/sanitisationMv
// entirely for the MCP write path applies just as much to unattended
// controller telemetry. That leaves an accepted gap: a sentinel on
// ph/sanitisationMv, or an upper-bound sentinel on any field (no field here
// has a maximum in getImpossibleValueError), passes through untouched --
// the same tradeoff the MCP write path already makes.
function plausible(field: NumericReadingField, value: number | null): number | null {
  if (value == null) return null;
  return getImpossibleValueError(field, value) === '' ? value : null;
}

// Small allowance for clock skew between the controller/Hanna Cloud and this
// server -- not a guess at "now" (see the throw below), just a sanity
// ceiling. Without it, a garbage far-future timestamp becomes sync.ts's
// permanent "last synced" watermark: every subsequent legitimate reading
// compares as older than it and is silently skipped -- potentially for
// months -- while the endpoint keeps returning a normal-looking
// "not-newer-than-last-sync" result instead of an error anyone would notice.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// A measurement timestamp has to pin an unambiguous instant, not just parse
// as *some* date -- unlike server.ts's isValidIsoDate (built for MCP query
// *bounds*), sync.ts dedupes readings by this exact value. This requires the
// full date-time (not just a date). The UTC offset is optional: Hanna's
// controllers send offset-less times, and Hanna's own decoder reads those as
// UTC (dayjs.utc). normaliseHannaTimestampString pins that explicitly, so an
// offset-less string is never left to Date's local-time parsing.
// The fractional part is captured, not merely matched: normaliseHannaTimestampString
// rebuilds the wall clock from these groups when a device clock is configured, and
// a non-capturing `(?:\.\d+)?` silently dropped up to 999ms on the way through.
// sync.ts dedupes on the exact timestamp, so a truncated one can compare as
// not-newer against a reading already stored with its fraction intact.
const STRICT_ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

// Date.parse (and therefore `new Date(str)`) silently normalizes
// calendar-invalid strings (2026-02-30 becomes March 2) and happily accepts
// non-ISO, locale-dependent formats (09/26/2026) instead of rejecting them --
// either would become sync.ts's permanent dedupe watermark, so parseability
// alone isn't enough here (see parseHannaTimestamp below).
/**
 * What an offset-less Hanna timestamp means -- i.e. what the controller's own
 * clock is set to.
 *
 * Hanna's controllers send a bare wall-clock reading with no offset, and
 * Hanna's own decoder reads it as UTC (`dayjs.utc`), so `utc` stays the
 * default and nothing changes for a deployment that doesn't configure this.
 * But the clock is set by hand on the keypad, and an installer who sets it
 * to local time -- the obvious thing to do, since that is what the device
 * then displays to whoever is standing in front of it -- makes every reading
 * arrive labelled hours in the future, where the skew guard rejects it.
 *
 * Declaring the offset is not the same as widening MAX_CLOCK_SKEW_MS. The
 * skew guard exists to catch a *wrong* clock; this says the clock is right
 * and states which zone it is keeping, so the stored instant is correct
 * rather than merely accepted.
 *
 * Two shapes, because a controller may or may not observe DST and we can't
 * assume:
 * - `zone`: an IANA zone, converted per-timestamp, so DST is handled for a
 *   device that follows a region's clock changes.
 * - `offset`: a fixed number of minutes, for a device left on one offset
 *   year-round (which a simple controller with no DST setting effectively
 *   is, even when sited somewhere that observes it).
 * Picking the wrong one of the two is silent until a DST boundary, so the
 * fixed offset is the safer default for hardware whose DST behaviour has
 * not actually been observed across a transition.
 */
export type DeviceClock =
  | { kind: 'utc' }
  | { kind: 'zone'; timeZone: string }
  | { kind: 'offset'; minutes: number };

export const UTC_DEVICE_CLOCK: DeviceClock = { kind: 'utc' };

// Minutes that `timeZone`'s local wall clock is ahead of UTC at `instantMs`.
// Derived by formatting the instant in that zone and reading the result back
// as if it were UTC -- the difference is the offset, DST included.
function zoneOffsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
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
 * The offset to stamp on a wall clock reading of `wallClockAsUtcMs` (the
 * bare timestamp parsed as though it were UTC), disambiguated against
 * `nowMs`.
 *
 * Most of the year one offset is possible and this is a lookup. Twice a year
 * it isn't, and the DST-aware mode has to earn its name at exactly those two
 * moments:
 *
 * - **Autumn fall-back** repeats an hour of local time. In Europe/London on
 *   2026-10-25, local 01:30 is both 00:30Z (BST) and 01:30Z (GMT). Picking
 *   blindly is not a harmless coin flip: choose the later instant for a
 *   reading that came from the earlier one and it lands an hour in the
 *   future, where MAX_CLOCK_SKEW_MS rejects it -- so the controller goes
 *   dark for that hour every year. Choose the earlier one in a zone where
 *   that's the wrong guess and the hour instead falls behind sync.ts's
 *   watermark and is silently skipped.
 * - **Spring forward** skips an hour, so the local time never existed at
 *   all. Nothing can be correct here; taking the zone's offset at the naive
 *   instant keeps the reading rather than dropping it, which is the right
 *   trade for telemetry.
 *
 * The disambiguator is the server clock. Controller telemetry is read
 * minutes after it is measured, so of the two candidate instants the one
 * nearer `nowMs` is the one that actually happened. That is the fact a
 * timestamp alone cannot supply.
 */
function zoneOffsetMinutesForWallClock(wallClockAsUtcMs: number, timeZone: string, nowMs: number): number {
  // Sample a day either side so both sides of any transition are seen.
  const candidates = new Set<number>();
  for (const probe of [wallClockAsUtcMs - 86_400_000, wallClockAsUtcMs, wallClockAsUtcMs + 86_400_000]) {
    candidates.add(zoneOffsetMinutesAt(probe, timeZone));
  }
  // An offset is only real if it round-trips: the instant it implies must
  // itself sit at that offset in the zone. In the spring gap none do; in the
  // autumn overlap two do.
  const real = [...candidates].filter(
    (offset) => zoneOffsetMinutesAt(wallClockAsUtcMs - offset * 60_000, timeZone) === offset,
  );
  if (real.length === 0) return zoneOffsetMinutesAt(wallClockAsUtcMs, timeZone);
  if (real.length === 1) return real[0];
  return real.reduce((best, offset) =>
    Math.abs(wallClockAsUtcMs - offset * 60_000 - nowMs) < Math.abs(wallClockAsUtcMs - best * 60_000 - nowMs)
      ? offset : best);
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function normaliseHannaTimestampString(value: string, clock: DeviceClock, nowMs: number): string | null {
  const match = STRICT_ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, fraction, offset] = match;
  // Validate Hanna's suffix before a configured clock discards it. Regex
  // shape alone accepts +24:00/+99:99; replacing those would turn corrupt
  // upstream input into a plausible timestamp and dedupe watermark.
  if (offset && offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) return null;
  }
  if (!isValidCalendarDateTime(Number(y), Number(m), Number(d), Number(hh), Number(mm), ss != null ? Number(ss) : undefined)) {
    return null;
  }
  // With no device clock configured, an offset Hanna sent stands as-is and a
  // bare value is read as UTC -- the original behaviour, unchanged.
  if (clock.kind === 'utc') {
    const normalised = offset === undefined ? `${value}Z` : value;
    return Number.isNaN(Date.parse(normalised)) ? null : normalised;
  }

  // With one configured, it wins even over an offset Hanna supplied, and the
  // wall-clock portion is reinterpreted in the device's own zone.
  //
  // This reverses the previous rule ("an offset Hanna actually sent is
  // authoritative"), which was wrong about what that offset means. The
  // controller sends a bare wall clock; Hanna's own decoder reads it as UTC
  // (dayjs.utc). So a "Z" arriving on a dashboard `lastUpdate` is not an
  // independent measurement of the device's offset -- it is that same
  // assumption echoed back, and treating it as authoritative let Hanna's
  // guess silently override an operator who had physically read the clock on
  // the front of the device. The configuration is a statement about the
  // hardware; the Z is a statement about Hanna's default.
  //
  // At Joy Lane this is the difference between working and not: the device
  // keeps correct UK local time, every reading arrives an hour in the future,
  // and setting HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES changed nothing because
  // the dashboard path (client.ts assigns `messages.lastUpdate` over the
  // decoded DT) never produced an offset-less value for the config to fix.
  //
  // If Hanna ever does convert properly, this would reinterpret a correct
  // timestamp and land an offset out. Keep the configured clock aligned with
  // the hardware; successful normalization is routine and must not log on
  // every scheduled poll. Existing failure diagnostics remain available.
  // Rebuilt from the matched parts rather than sliced off `value`: whatever
  // offset Hanna supplied has to go before the device's own is appended, or
  // the result is a string carrying two of them.
  const wallClock = `${y}-${m}-${d}T${hh}:${mm}:${ss ?? '00'}${fraction ?? ''}`;
  const wallClockAsUtcMs = Date.parse(`${wallClock}Z`);
  if (Number.isNaN(wallClockAsUtcMs)) return null;
  const minutes = clock.kind === 'offset'
    ? clock.minutes
    : zoneOffsetMinutesForWallClock(wallClockAsUtcMs, clock.timeZone, nowMs);
  const normalised = `${wallClock}${offsetSuffix(minutes)}`;
  return Number.isNaN(Date.parse(normalised)) ? null : normalised;
}

/**
 * Builds a DeviceClock from the two env vars, or throws with the variable
 * named. Deliberately throws rather than falling back to UTC on a bad value:
 * a typo'd zone silently reverting to the old behaviour would put back
 * exactly the bug this exists to fix, and leave a diagnostic that says the
 * controller's clock is wrong when the configuration is.
 *
 * A fixed offset wins over a zone when both are set -- it's the more
 * specific claim about the hardware.
 */
export function resolveDeviceClock(
  timeZone: string | undefined,
  offsetMinutes: string | undefined,
): DeviceClock {
  const rawOffset = offsetMinutes?.trim();
  if (rawOffset) {
    const minutes = Number(rawOffset);
    if (!Number.isInteger(minutes) || Math.abs(minutes) > 14 * 60) {
      throw new HannaCloudError(
        'HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES must be a whole number of minutes between -840 and 840.',
        'HC_DEVICE_CLOCK_CONFIG',
      );
    }
    return { kind: 'offset', minutes };
  }
  const zone = timeZone?.trim();
  if (zone) {
    // Intl alone is too permissive to validate with: it also accepts bare
    // abbreviations like "BST" and raw offsets like "+01:00". The first is
    // ambiguous -- British Summer Time and Bangladesh Standard Time are five
    // hours apart -- and the second is a fixed offset wearing a zone's
    // clothes, for which HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES is the honest
    // field. Require the canonical Region/City form so a misconfiguration
    // fails here instead of silently producing the wrong instant for half
    // the year.
    const canonical = zone === 'UTC' || /^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+/-]+$/.test(zone);
    let known = false;
    if (canonical) {
      try {
        // Throws RangeError on an unknown zone; no other way to check one.
        new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(0);
        known = true;
      } catch {
        known = false;
      }
    }
    if (!known) {
      throw new HannaCloudError(
        `HANNA_CLOUD_DEVICE_TIMEZONE must be a canonical IANA zone such as Europe/London (got: ${zone}). For a device on a fixed offset, set HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES instead.`,
        'HC_DEVICE_CLOCK_CONFIG',
      );
    }
    return { kind: 'zone', timeZone: zone };
  }
  return UTC_DEVICE_CLOCK;
}

// Round, generous lower bound -- this integration (and this app) couldn't
// plausibly have been running before this many years ago, so anything
// older is a sentinel/error value, not a real reading. Without this, a
// sentinel like `dt: 0` (or any small/negative number some hardware sends
// for an error state) parses to 1970-01-01 and passes every other check.
// On a fresh sync with no prior watermark or readings, that epoch reading
// would become readings[0] -- briefly the dashboard's entire "current
// status" -- until a real reading arrives; on an established deployment it
// still permanently pollutes readings/ with an impossible data point that
// History/WeeklyReport would eventually surface. Generous on purpose: this
// only needs to catch obviously-wrong sentinels, not legitimately old
// readings, which shouldn't happen with live telemetry anyway.
const MAX_PAST_YEARS = 10;
const MIN_PLAUSIBLE_MS = Date.now() - MAX_PAST_YEARS * 365 * 24 * 60 * 60 * 1000;

/**
 * Hanna Cloud's device-log timestamp shape isn't documented anywhere
 * public, so this accepts either a strict ISO-8601 date-time string (full
 * calendar validity and time-of-day; an offset-less value is read as UTC --
 * see normaliseHannaTimestampString) or a Unix epoch in seconds or milliseconds.
 * Deliberately throws rather than falling back to "now" -- or accepting a
 * calendar-invalid or non-ISO string `new Date()` would silently normalize
 * or misparse -- on anything else: sync.ts dedupes by this timestamp, so a
 * wrong-but-plausible value would make every subsequent legitimate reading
 * look "not newer" and get silently skipped, potentially for months.
 */
function parseHannaTimestamp(dt: unknown, clock: DeviceClock = UTC_DEVICE_CLOCK): Date {
  // Read once and reused throughout: by the DST disambiguation below, and by
  // both the skew comparison and its diagnostic -- two separate Date.now()
  // calls can straddle the boundary, so a reading rejected as 1ms past the
  // allowance could be reported as inside it.
  const now = Date.now();
  let parsed: Date | null = null;
  if (typeof dt === 'string') {
    const normalised = normaliseHannaTimestampString(dt, clock, now);
    if (normalised) parsed = new Date(normalised);
  } else if (typeof dt === 'number' && Number.isFinite(dt)) {
    // Sub-second-precision epochs (seconds) are ~10 digits today; ms epochs are ~13.
    const ms = dt < 1e12 ? dt * 1000 : dt;
    parsed = new Date(ms);
  }
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new HannaCloudError('Unrecognized Hanna Cloud reading timestamp.', 'HC_TIMESTAMP_FORMAT');
  }
  if (parsed.getTime() > now + MAX_CLOCK_SKEW_MS) {
    // How far ahead, as a duration only -- never the timestamp itself, the
    // payload it came from, or the device it came from (diagnostics policy
    // above). HC_TIMESTAMP_FUTURE on its own can't distinguish the two
    // causes, and they have completely different fixes: a whole number of
    // hours means the controller is on the wrong timezone (it sends an
    // offset-less wall clock that normaliseHannaTimestampString pins as
    // UTC), while minutes mean genuine clock drift on the device. Without
    // this the only way to tell them apart is to add a temporary log line
    // and redeploy, which is exactly what this saves.
    //
    // Seconds rounded *up*, not minutes rounded to nearest: a rejected skew
    // is by definition greater than the allowance, and rounding hid that
    // for the marginal-drift case this is meant to identify -- 5m01s ahead
    // printed as "5" beside an allowance of "5", a rejection that reads as
    // though it should have passed. Ceil keeps the reported figure strictly
    // above the reported allowance for every value that can reach this
    // line, and seconds still show a timezone at a glance (~3600 is an hour).
    console.warn('Hanna reading timestamp is ahead of the server clock', JSON.stringify({
      aheadSeconds: Math.ceil((parsed.getTime() - now) / 1000),
      skewAllowanceSeconds: MAX_CLOCK_SKEW_MS / 1000,
    }));
    throw new HannaCloudError('Hanna Cloud reading timestamp is implausibly far in the future.', 'HC_TIMESTAMP_FUTURE');
  }
  if (parsed.getTime() < MIN_PLAUSIBLE_MS) {
    throw new HannaCloudError('Hanna Cloud reading timestamp is implausibly far in the past.', 'HC_TIMESTAMP_PAST');
  }
  return parsed;
}

export interface HannaCloudSourceOptions {
  email: string;
  password: string;
  /** Skips the getDevices() lookup when set; required if the account has more than one BL12x/BL13x device. */
  deviceId?: string;
  /** What the controller's own clock is set to; defaults to UTC. See DeviceClock. */
  deviceClock?: DeviceClock;
}

export class HannaCloudSource implements PoolControllerSource {
  readonly id = 'hanna-cloud';

  private readonly client: HannaCloudClient;
  private readonly configuredDeviceId: string | undefined;
  private readonly deviceClock: DeviceClock;
  private authenticated = false;
  private resolvedDeviceId: string | undefined;

  constructor(options: HannaCloudSourceOptions) {
    this.client = new HannaCloudClient(options.email, options.password);
    this.configuredDeviceId = options.deviceId?.trim() || undefined;
    this.deviceClock = options.deviceClock ?? UTC_DEVICE_CLOCK;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.authenticated) return;
    await this.client.authenticate();
    this.authenticated = true;
  }

  private async resolveDeviceId(): Promise<string> {
    if (this.configuredDeviceId) return this.configuredDeviceId;
    if (this.resolvedDeviceId) return this.resolvedDeviceId;

    const devices = await this.client.getDevices();
    if (devices.length === 0) {
      throw new HannaCloudError('This Hanna Cloud account has no BL12x/BL13x devices registered.', 'HC_DEVICE_NONE');
    }
    if (devices.length > 1) {
      const names = devices.map((d) => `${d.deviceName} (${d.did})`).join(', ');
      throw new HannaCloudError(`Multiple Hanna Cloud devices found (${names}) — set HANNA_CLOUD_DEVICE_ID to pick one.`, 'HC_DEVICE_MULTIPLE');
    }
    this.resolvedDeviceId = devices[0].did;
    return this.resolvedDeviceId;
  }

  async getLatestReading(): Promise<PoolControllerReading | null> {
    await this.ensureAuthenticated();
    const deviceId = await this.resolveDeviceId();
    const reading = await this.client.getLastDeviceReading(deviceId);

    const ph = plausible('ph', findParameterNumber(reading.parameters, 'ph'));
    const sanitisationMv = plausible('sanitisationMv', findParameterNumber(reading.parameters, 'orp'));
    const temperature = plausible('temperature', findParameterNumber(reading.parameters, 'temp'));

    // A snapshot with no usable measurement at all isn't a partial reading,
    // it's nothing -- returning it would write an all-null Reading (hiding
    // the dashboard's previous, real pH/ORP snapshot behind it) and would
    // still advance sync.ts's dedupe watermark, so a later corrected
    // response for the same instant would be silently rejected as
    // "not newer than last sync".
    if (ph == null && sanitisationMv == null && temperature == null) {
      return null;
    }

    return {
      ph,
      sanitisationMv,
      temperature,
      recordedAt: parseHannaTimestamp(reading.dt, this.deviceClock),
    };
  }
}
