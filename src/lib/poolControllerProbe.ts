export interface PoolControllerProbeResult {
  mode: 'probe';
  written: false;
  outcome: 'reading-available' | 'no-reading-available';
  reading: {
    ph: number | null;
    sanitisationMv: number | null;
    temperature: number | null;
    recordedAt: string;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Do not treat an HTML login page or an unrelated JSON payload as a successful probe. */
export async function parsePoolControllerProbeResponse(response: Response): Promise<PoolControllerProbeResult> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' && body.error.trim()
      ? body.error
      : `Connection test failed (${response.status}). Check that you are signed in and the deployment is accessible.`;
    throw new Error(message);
  }
  const invalidResponse = 'The connection test returned an unexpected response. Check deployment access and try again. Nothing saved.';
  if (!isRecord(body) || body.mode !== 'probe' || body.written !== false) {
    throw new Error(invalidResponse);
  }
  if (body.outcome === 'no-reading-available' && body.reading === null) {
    return body as unknown as PoolControllerProbeResult;
  }
  if (body.outcome !== 'reading-available' || !isRecord(body.reading)) {
    throw new Error(invalidResponse);
  }
  const reading = body.reading;
  const values = [reading.ph, reading.sanitisationMv, reading.temperature];
  if (!values.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))) ||
      !values.some((v) => typeof v === 'number') ||
      typeof reading.recordedAt !== 'string' || !Number.isFinite(Date.parse(reading.recordedAt))) {
    throw new Error(invalidResponse);
  }
  return body as unknown as PoolControllerProbeResult;
}
