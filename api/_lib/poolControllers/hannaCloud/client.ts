import { createCipheriv, randomInt } from 'node:crypto';

// Hanna Instruments doesn't publish a public API for Hanna Cloud. This
// client is a TypeScript port of the reverse-engineered, MIT-licensed
// Python client that backs the official Home Assistant "Hanna" integration
// (added in HA 2025.12): https://github.com/bestycame/hanna_cloud — itself
// explicitly documented as "NOT officially supported by Hanna". Ported
// rather than wrapped because this project is TypeScript throughout and
// runs on Vercel's Node runtime, not Python.
//
// Because it isn't official, Hanna can change or break this without
// notice — see the pool-controller-telemetry section of CLAUDE.md.

const BASE_URL = 'https://www.hannacloud.com/api';

// Not a secret: this key is embedded in Hanna Cloud's own webapp JavaScript
// (https://www.hannacloud.com) and is used to obfuscate credentials
// in-transit, not to protect them — the same key ships in every client,
// including the reverse-engineered one this is ported from.
const ENCRYPTION_KEY_BASE64 = 'MzJmODBmMDU0ZTAyNDFjYWM0YTVhOGQxY2ZlZTkwMDM=';

const IV_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export class HannaCloudError extends Error {
  constructor(message: string, readonly diagnosticCode = 'HC_UNEXPECTED') {
    super(message);
    this.name = new.target.name;
  }
}
export class HannaAuthenticationError extends HannaCloudError {}
export class HannaDeviceNotFoundError extends HannaCloudError {}
export class HannaApiError extends HannaCloudError {
  constructor(message: string, readonly statusCode?: number, diagnosticCode = 'HC_API') {
    super(message, diagnosticCode);
  }
}

export interface HannaDevice {
  did: string;
  deviceName: string;
  modelGroup: string;
}

export interface HannaReadingParameter {
  name: string;
  value: unknown;
}

export interface HannaDeviceReading {
  did: string;
  /** Raw device-reported timestamp field, in whatever shape Hanna Cloud sends it. */
  dt: unknown;
  parameters: HannaReadingParameter[];
}

/** AES-CBC-encrypts `plaintext` the way Hanna Cloud's webapp does: a random 16-char IV, PKCS7 padding, `"<iv>:<hex ciphertext>"`. */
function hannaEncrypt(plaintext: string): string {
  const key = Buffer.from(ENCRYPTION_KEY_BASE64, 'base64'); // 32 bytes -> AES-256
  let iv = '';
  for (let i = 0; i < 16; i++) iv += IV_ALPHABET[randomInt(IV_ALPHABET.length)];
  const cipher = createCipheriv('aes-256-cbc', key, Buffer.from(iv, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv}:${encrypted.toString('hex')}`;
}

const LOGIN_QUERY = `
  query Login($email: String!, $password: String!, $userLanguage: String!, $source: String) {
    login(email: $email, password: $password, language: $userLanguage, source: $source) {
      token
      tokenType
    }
  }
`;

const DEVICES_QUERY = `
  query Devices($modelGroups: [String!], $deviceLogs: Boolean!) {
    devices(modelGroups: $modelGroups, deviceLogs: $deviceLogs) {
      DID
      DM
      modelGroup
      DINFO {
        deviceName
      }
    }
  }
`;

const LAST_DEVICE_READING_QUERY = `
  query GetLastDeviceReading($deviceIds: [String!]) {
    lastDeviceReadings(deviceIds: $deviceIds) {
      DID
      DT
      messages
    }
  }
`;

// Hanna's current dashboard uses this query rather than lastDeviceReadings.
// Request only its data envelope and select the exact DID below; never expose
// other devices, account preferences, or the rest of the dashboard response.
const DASHBOARD_READING_QUERY = `
  query GetDashboardData($modelGroup: String, $modelsList: [String], $isWebview: Boolean) {
    getDashboardData(modelGroup: $modelGroup, modelsList: $modelsList, isWebview: $isWebview) {
      data
    }
  }
`;

// Model-group names Hanna's web bundle defines for BL controllers (BL12x,
// BL13x, BL13xs). The dashboard feed only returns a controller under its own
// group, and this integration doesn't know which group a device is in.
const DASHBOARD_MODEL_GROUPS = ['BL12x', 'BL13x', 'BL13xs'] as const;
const DASHBOARD_MODELS = ['BL122', 'BL123', 'BL132', 'BL136'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasMeasurements(reading: HannaDeviceReading): boolean {
  return reading.parameters.some((parameter) => {
    if (!parameter || !['ph', 'orp', 'temp'].includes(parameter.name)) return false;
    const value = parameter.value;
    return (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  });
}

interface GraphQlRequestBody {
  operationName: string;
  variables: Record<string, unknown>;
  query: string;
}

/** Hanna's BL12x/BL132 web decoder maps RD to pH, ORP mV, temperature C.
 * Verified against https://www.hannacloud.com/static/js/main.3aa1b267.js
 * (2026-10-18). Other model layouts must not be guessed from array positions.
 */
function decodeRawPoolParameters(did: string, messages: Record<string, unknown>): HannaReadingParameter[] {
  if (!/^BL(?:122|123|132)_/.test(did) || typeof messages.RD !== 'string') return [];
  // The vendor suppresses RD when connectionState is present or EV bit 20
  // signals no_probe_connected. Numeric-looking cached values are not evidence
  // of a working probe in either case.
  if (Object.prototype.hasOwnProperty.call(messages, 'connectionState')) return [];
  const alarm = typeof messages.EV === 'string' ? messages.EV.split(',')[0] : undefined;
  if (alarm && /^[0-9a-f]{1,64}$/i.test(alarm) && (BigInt(`0x${alarm}`) & (1n << 20n)) !== 0n) return [];
  const values = messages.RD.split(',');
  if (values.length !== 3 && values.length !== 4) return [];
  return ['ph', 'orp', 'temp'].map((name, index) => ({ name, value: values[index] }));
}

function rawPoolTimestamp(value: unknown): unknown {
  // Deliberately passes an offset-less raw DT through untouched.
  //
  // This used to append "Z" here, matching Hanna's own raw decoder
  // (dayjs.utc). That reading is still the default -- source.ts applies it
  // when no device clock is configured, so behaviour is unchanged -- but
  // pinning it in the client made the assumption unoverridable: a controller
  // whose keypad clock is set to local time sends a local wall clock, and
  // stamping UTC on it here meant the device-clock configuration could never
  // see an offset-less value to correct. Decoding the payload belongs to the
  // client; deciding what a bare wall clock means belongs to the source,
  // which is where the configuration, the calendar check and the clock-skew
  // guard already live.
  return value;
}

export class HannaCloudClient {
  private accessToken: string | undefined;
  private readonly email: string;
  private readonly password: string;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  private async request(endpoint: 'auth' | 'graphql', body: GraphQlRequestBody, isRetry = false): Promise<Record<string, unknown>> {
    // Only this fixed, local allowlist enters diagnostic codes. Never include
    // query text, upstream error messages, IDs, credentials, or response bodies.
    const stage = ({ Login: 'LOGIN', Devices: 'DEVICES', GetLastDeviceReading: 'LATEST', GetDashboardData: 'DASHBOARD' } as Record<string, string>)[body.operationName] ?? 'QUERY';
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new HannaApiError('Hanna Cloud could not be reached.', undefined, `HC_${stage}_NETWORK`);
    }

    // Re-auth-and-retry-once only applies to authenticated GraphQL calls
    // whose token has expired. A 403 on the auth/login call itself means
    // the credentials are wrong — authenticate() calling back into this
    // method (with isRetry defaulting to false again) would otherwise
    // recurse indefinitely instead of surfacing HannaAuthenticationError.
    if (endpoint === 'graphql' && response.status === 403 && !isRetry) {
      await this.authenticate();
      return this.request(endpoint, body, true);
    }

    if (!response.ok) {
      if (response.status === 404) throw new HannaDeviceNotFoundError(`Resource not found: ${endpoint}`, `HC_${stage}_NOT_FOUND`);
      if (response.status === 401 || response.status === 403) throw new HannaAuthenticationError('Invalid Hanna Cloud credentials or expired token.', `HC_${stage}_AUTH`);
      throw new HannaApiError(`Hanna Cloud request failed: HTTP ${response.status}`, response.status, `HC_${stage}_HTTP`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new HannaApiError('Hanna Cloud returned a non-JSON response.', undefined, `HC_${stage}_JSON`);
    }
    if (record(json) && Array.isArray(json.errors) && json.errors.length > 0) {
      // GraphQL can fail with HTTP 200. Do not turn that into an apparently
      // connected-but-empty result or include upstream messages/tokens in errors.
      throw new HannaApiError('Hanna Cloud returned a GraphQL error.', undefined, `HC_${stage}_GRAPHQL`);
    }
    const data = (json as { data?: Record<string, unknown> })?.data;
    return data ?? {};
  }

  /** Authenticates and caches the access token used by subsequent calls; safe to call again to force re-auth. */
  async authenticate(): Promise<void> {
    const body: GraphQlRequestBody = {
      operationName: 'Login',
      variables: {
        email: hannaEncrypt(this.email),
        password: hannaEncrypt(this.password),
        userLanguage: 'English',
        source: 'web',
      },
      query: LOGIN_QUERY,
    };

    // Mirrors the reverse-engineered client's retry: Hanna Cloud's login
    // endpoint has been observed to occasionally return an empty result
    // on the first attempt.
    let tokens: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await this.request('auth', body);
      tokens = data.login;
      if (Array.isArray(tokens) && tokens.length > 0) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new HannaAuthenticationError('Hanna Cloud login did not return an access token — check HANNA_CLOUD_EMAIL/HANNA_CLOUD_PASSWORD.', 'HC_LOGIN_TOKEN');
    }
    const accessToken = (tokens as Array<{ tokenType?: string; token?: string }>).find((t) => t.tokenType === 'accessToken')?.token;
    if (!accessToken) {
      throw new HannaAuthenticationError('Hanna Cloud login response did not include an accessToken.', 'HC_LOGIN_TOKEN');
    }
    this.accessToken = accessToken;
  }

  private requireAuthenticated(): void {
    if (!this.accessToken) throw new HannaAuthenticationError('Call authenticate() before making authenticated Hanna Cloud requests.');
  }

  async getDevices(): Promise<HannaDevice[]> {
    this.requireAuthenticated();
    const data = await this.request('graphql', {
      operationName: 'Devices',
      variables: { modelGroups: ['BL12x', 'BL13x', 'BL13xs'], deviceLogs: false },
      query: DEVICES_QUERY,
    });
    const devices = Array.isArray(data.devices) ? data.devices : [];
    return (devices as Array<Record<string, unknown>>).map((d) => ({
      did: String(d.DID ?? ''),
      deviceName: String((d.DINFO as { deviceName?: string } | undefined)?.deviceName ?? d.DID ?? 'Hanna device'),
      modelGroup: String(d.modelGroup ?? ''),
    }));
  }

  async getLastDeviceReading(deviceId: string): Promise<HannaDeviceReading> {
    this.requireAuthenticated();
    if (!deviceId) throw new HannaCloudError('deviceId is required.');
    const data = await this.request('graphql', {
      operationName: 'GetLastDeviceReading',
      variables: { deviceIds: [deviceId] },
      query: LAST_DEVICE_READING_QUERY,
    });
    const readings = Array.isArray(data.lastDeviceReadings) ? data.lastDeviceReadings : [];
    const reading = readings.find((item) => record(item) && item.DID === deviceId) as Record<string, unknown> | undefined;
    const legacy = reading ? this.decodeReading(reading, deviceId) : undefined;
    if (legacy && hasMeasurements(legacy)) return legacy;

    // Some controller/account responses from the legacy query have no usable
    // parameters even while the current Hanna dashboard shows live values.
    // Query that same read-only dashboard feed before concluding there is none.
    const current = await this.findDashboardReading(deviceId);
    const messages = record(current.messages) ? current.messages : {};
    const result = this.decodeReading(current, deviceId);
    // This is the timestamp Hanna's dashboard displays for this measurement.
    // Do not substitute the server clock or a CSV export time.
    result.dt = messages.lastUpdate ?? result.dt;
    if (!hasMeasurements(result)) {
      // Schema-only diagnostics for the operator: no device IDs, measurement
      // values, arbitrary field names, tokens, credentials, or response bodies.
      console.info('Hanna dashboard returned no usable measurements', {
        messagesShape: Array.isArray(current.messages) ? 'array' : typeof current.messages,
        namedParameterCount: Array.isArray(messages.parameters) ? messages.parameters.length : 0,
        rawReadingPresent: typeof messages.RD === 'string',
        offline: messages.connectionState === 'offline',
      });
    }
    return result;
  }

  /**
   * Finds the exact configured device in Hanna's dashboard feed. The feed is
   * filtered by model group, so each group Hanna's web app defines is tried in
   * turn (the first one that contains the device wins). Only the dashboard
   * feed is read here; nothing is written and no other device is substituted.
   */
  private async findDashboardReading(deviceId: string): Promise<Record<string, unknown>> {
    // Schema-only summary of what each group returned, for diagnosing a miss:
    // counts and model/group labels, never device IDs or values.
    const groupSummaries: Array<{ modelGroup: string; entries: number; modelGroups: string[]; models: string[] }> = [];
    const feedDeviceIds = new Set<string>();
    for (const modelGroup of DASHBOARD_MODEL_GROUPS) {
      const dashboard = await this.request('graphql', {
        operationName: 'GetDashboardData',
        variables: { modelGroup, modelsList: DASHBOARD_MODELS, isWebview: false },
        query: DASHBOARD_READING_QUERY,
      });
      const envelope = record(dashboard.getDashboardData) ? dashboard.getDashboardData.data : undefined;
      if (!record(envelope) || !Array.isArray(envelope.readingsData)) {
        throw new HannaApiError('Hanna Cloud dashboard response has an unrecognized format.', undefined, 'HC_DASHBOARD_FORMAT');
      }
      const entries = envelope.readingsData.filter(record);
      const matches = entries.filter((item) => item.DID === deviceId);
      if (matches.length > 1) throw new HannaApiError('Hanna Cloud returned ambiguous dashboard readings.', undefined, 'HC_DASHBOARD_AMBIGUOUS');
      if (matches.length === 1) return matches[0];
      groupSummaries.push({
        modelGroup,
        entries: entries.length,
        modelGroups: [...new Set(entries.map((item) => String(item.modelGroup ?? 'unset')))].slice(0, 10),
        models: [...new Set(entries.map((item) => String(item.DM ?? 'unset')))].slice(0, 10),
      });
      for (const item of entries) feedDeviceIds.add(String(item.DID));
    }
    // Serialised: console.info stops at depth 2, so nested label arrays would
    // otherwise print as [Array] in the Vercel log.
    console.info('Hanna dashboard feed has no entry for the selected device', JSON.stringify({ groups: groupSummaries }));
    // TEMPORARY diagnostic (approved by the account owner): prints the ID the
    // server selected and the IDs the dashboard feed returned, to find the
    // mismatch. Remove once HANNA_CLOUD_DEVICE_ID is set and confirmed.
    console.info('TEMP Hanna ID comparison', JSON.stringify({ selected: deviceId, feed: [...feedDeviceIds].slice(0, 10) }));
    throw new HannaDeviceNotFoundError('The selected device is not present in the Hanna Cloud dashboard feed.', 'HC_DASHBOARD_DEVICE');
  }

  private decodeReading(reading: Record<string, unknown>, deviceId: string): HannaDeviceReading {
    const messages = (reading.messages ?? {}) as Record<string, unknown>;
    const did = String(reading.DID ?? deviceId);
    // An empty `parameters` array carries no measurements, so it must not
    // shadow raw RD telemetry on the same snapshot.
    const hasNamedParameters = Array.isArray(messages.parameters) && messages.parameters.length > 0;
    const parameters = hasNamedParameters
      ? (messages.parameters as HannaReadingParameter[])
      : decodeRawPoolParameters(did, messages);
    const rawPoolFormat = !hasNamedParameters && /^BL(?:122|123|132)_/.test(did) && typeof messages.RD === 'string';
    const dt = rawPoolFormat ? rawPoolTimestamp(reading.DT ?? messages.DT) : reading.DT;
    return { did, dt, parameters };
  }
}
