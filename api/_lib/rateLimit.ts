interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Best-effort per-instance rate limiter.
 *
 * Vercel serverless functions can run across multiple isolated
 * instances/regions, so an in-memory Map does not give the same hard
 * global guarantee a shared store (Redis/Upstash) would. It still
 * meaningfully throttles repeated abuse from the same caller within a
 * warm container/lambda instance, which is the common shape of scripted
 * abuse against a public endpoint — and it costs no extra infrastructure.
 *
 * Returns true when `key` has exceeded `limit` requests within the
 * current `windowMs` window.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}
