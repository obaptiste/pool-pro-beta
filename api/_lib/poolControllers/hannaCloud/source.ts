import { isValidCalendarDateTime } from '../../isoDate';
import type { PoolControllerReading, PoolControllerSource } from '../types';
import { HannaCloudClient, HannaCloudError, type HannaReadingParameter } from './client';

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
// *bounds*, where a bare date or an offset-less date-time is a reasonable
// boundary), sync.ts dedupes readings by this exact value, so an offset-less
// string would parse as the server's local time zone rather than UTC and
// could silently shift the watermark by hours. This requires the full
// date-time (not just a date) plus a mandatory Z/±HH:MM offset, on top of
// the same calendar-validity check isValidIsoDate uses (isValidCalendarDateTime).
const STRICT_ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// Date.parse (and therefore `new Date(str)`) silently normalizes
// calendar-invalid strings (2026-02-30 becomes March 2) and happily accepts
// non-ISO, locale-dependent formats (09/26/2026) instead of rejecting them --
// either would become sync.ts's permanent dedupe watermark, so parseability
// alone isn't enough here (see parseHannaTimestamp below).
function isValidHannaTimestampString(value: string): boolean {
  const match = STRICT_ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d, hh, mm, ss] = match;
  if (!isValidCalendarDateTime(Number(y), Number(m), Number(d), Number(hh), Number(mm), ss != null ? Number(ss) : undefined)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/**
 * Hanna Cloud's device-log timestamp shape isn't documented anywhere
 * public, so this accepts either a strict ISO-8601 date-time string (full
 * calendar validity, mandatory time-of-day and UTC offset -- see
 * isValidHannaTimestampString) or a Unix epoch in seconds or milliseconds.
 * Deliberately throws rather than falling back to "now" -- or accepting a
 * calendar-invalid or non-ISO string `new Date()` would silently normalize
 * or misparse -- on anything else: sync.ts dedupes by this timestamp, so a
 * wrong-but-plausible value would make every subsequent legitimate reading
 * look "not newer" and get silently skipped, potentially for months.
 */
function parseHannaTimestamp(dt: unknown): Date {
  let parsed: Date | null = null;
  if (typeof dt === 'string') {
    if (isValidHannaTimestampString(dt)) parsed = new Date(dt);
  } else if (typeof dt === 'number' && Number.isFinite(dt)) {
    // Sub-second-precision epochs (seconds) are ~10 digits today; ms epochs are ~13.
    const ms = dt < 1e12 ? dt * 1000 : dt;
    parsed = new Date(ms);
  }
  if (!parsed) {
    throw new HannaCloudError(`Unrecognized Hanna Cloud reading timestamp: ${JSON.stringify(dt)}`);
  }
  if (parsed.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new HannaCloudError(`Hanna Cloud reading timestamp is implausibly far in the future: ${parsed.toISOString()}`);
  }
  return parsed;
}

export interface HannaCloudSourceOptions {
  email: string;
  password: string;
  /** Skips the getDevices() lookup when set; required if the account has more than one BL12x/BL13x device. */
  deviceId?: string;
}

export class HannaCloudSource implements PoolControllerSource {
  readonly id = 'hanna-cloud';

  private readonly client: HannaCloudClient;
  private readonly configuredDeviceId: string | undefined;
  private authenticated = false;
  private resolvedDeviceId: string | undefined;

  constructor(options: HannaCloudSourceOptions) {
    this.client = new HannaCloudClient(options.email, options.password);
    this.configuredDeviceId = options.deviceId?.trim() || undefined;
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
      throw new HannaCloudError('This Hanna Cloud account has no BL12x/BL13x devices registered.');
    }
    if (devices.length > 1) {
      const names = devices.map((d) => `${d.deviceName} (${d.did})`).join(', ');
      throw new HannaCloudError(`Multiple Hanna Cloud devices found (${names}) — set HANNA_CLOUD_DEVICE_ID to pick one.`);
    }
    this.resolvedDeviceId = devices[0].did;
    return this.resolvedDeviceId;
  }

  async getLatestReading(): Promise<PoolControllerReading | null> {
    await this.ensureAuthenticated();
    const deviceId = await this.resolveDeviceId();
    const reading = await this.client.getLastDeviceReading(deviceId);

    const ph = findParameterNumber(reading.parameters, 'ph');
    const sanitisationMv = findParameterNumber(reading.parameters, 'orp');
    const temperature = findParameterNumber(reading.parameters, 'temp');

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
      recordedAt: parseHannaTimestamp(reading.dt),
    };
  }
}
