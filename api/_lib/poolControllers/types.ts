/**
 * One telemetry snapshot from a pool controller (e.g. a Hanna BL122), in
 * the same units PoolStatus's own Reading type uses — sanitisationMv is
 * ORP in mV, matching src/types.ts's Reading.sanitisationMv.
 */
export interface PoolControllerReading {
  ph: number | null;
  sanitisationMv: number | null;
  temperature: number | null;
  /** When the controller took this reading (not when we polled for it). */
  recordedAt: Date;
}

/**
 * What the sync job needs from a pool controller's cloud platform. Hanna
 * Cloud is the only implementation today, but nothing above this
 * interface knows that — a second controller brand, or an official API
 * if Hanna ever ships one, is a new implementation of this interface,
 * not a change to the sync logic or the cron entry point.
 */
export interface PoolControllerSource {
  /** Short identifier used in logs and stored alongside synced readings (e.g. "hanna-cloud"). */
  readonly id: string;
  /** Null when the controller has never reported a reading. */
  getLatestReading(): Promise<PoolControllerReading | null>;
}
