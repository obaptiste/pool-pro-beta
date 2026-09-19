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

export class HannaCloudError extends Error {}
export class HannaAuthenticationError extends HannaCloudError {}
export class HannaDeviceNotFoundError extends HannaCloudError {}
export class HannaApiError extends HannaCloudError {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
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

interface GraphQlRequestBody {
  operationName: string;
  variables: Record<string, unknown>;
  query: string;
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
    const response = await fetch(`${BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 403 && !isRetry) {
      await this.authenticate();
      return this.request(endpoint, body, true);
    }

    if (!response.ok) {
      if (response.status === 404) throw new HannaDeviceNotFoundError(`Resource not found: ${endpoint}`);
      if (response.status === 401 || response.status === 403) throw new HannaAuthenticationError('Invalid Hanna Cloud credentials or expired token.');
      throw new HannaApiError(`Hanna Cloud request failed: HTTP ${response.status}`, response.status);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new HannaApiError(`Hanna Cloud returned a non-JSON response: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new HannaAuthenticationError('Hanna Cloud login did not return an access token — check HANNA_CLOUD_EMAIL/HANNA_CLOUD_PASSWORD.');
    }
    const accessToken = (tokens as Array<{ tokenType?: string; token?: string }>).find((t) => t.tokenType === 'accessToken')?.token;
    if (!accessToken) {
      throw new HannaAuthenticationError('Hanna Cloud login response did not include an accessToken.');
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
    const reading = readings[0] as Record<string, unknown> | undefined;
    if (!reading) throw new HannaDeviceNotFoundError(`No readings found for device ${deviceId}`);

    const messages = (reading.messages ?? {}) as Record<string, unknown>;
    const parameters = Array.isArray(messages.parameters) ? (messages.parameters as HannaReadingParameter[]) : [];
    return { did: String(reading.DID ?? deviceId), dt: reading.DT, parameters };
  }
}
