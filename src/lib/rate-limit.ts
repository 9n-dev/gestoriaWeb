import 'server-only';
import { AppError } from './errors';
import { getRedis } from './redis';
import { requestMeta } from './request';

/** requests per window (seconds). Generous: they stop scripts, not people. */
const LIMITS = {
  login: [30, 600],
  twoFactor: [15, 600],
  magicLink: [10, 600],
  signup: [10, 3600],
  upload: [300, 600],
  webhook: [600, 60],
  clientError: [30, 600],
} as const;

/**
 * Sliding window in Redis (a sorted set of timestamps per caller, trimmed to the window): no burst
 * of 2x across a boundary, exact count over the last `windowSeconds`. Fails open: if Redis is down
 * people can still log in (the account lockout keeps protecting passwords).
 */
export async function rateLimit(bucket: keyof typeof LIMITS, key: string): Promise<void> {
  const [limit, windowSeconds] = LIMITS[bucket];
  let count: number;
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
    const redisKey = `rl:${bucket}:${key}`;
    const now = Date.now();
    const results = await redis
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowSeconds * 1000)
      .zadd(redisKey, now, `${now}-${Math.random()}`)
      .zcard(redisKey)
      .expire(redisKey, windowSeconds)
      .exec();
    count = Number(results?.[2]?.[1] ?? 0);
  } catch (error) {
    console.error('[rate-limit] redis unavailable, failing open', error);
    return;
  }
  if (count > limit) {
    throw new AppError(
      'RATE_LIMITED',
      'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    );
  }
}

/** Rate limit keyed by the caller's IP (plus an optional discriminator such as the email). */
export async function rateLimitByIp(bucket: keyof typeof LIMITS, extra = ''): Promise<void> {
  const { ip } = await requestMeta();
  await rateLimit(bucket, `${ip ?? 'unknown'}:${extra.toLowerCase()}`);
}
