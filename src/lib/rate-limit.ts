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
 * Fixed-window counter in Redis, keyed by bucket + caller. Fails open: if Redis is down people can
 * still log in (the account lockout keeps protecting passwords).
 * ponytail: fixed window allows a 2x burst across the boundary; sliding window if that ever matters.
 */
export async function rateLimit(bucket: keyof typeof LIMITS, key: string): Promise<void> {
  const [limit, windowSeconds] = LIMITS[bucket];
  let count: number;
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
    const redisKey = `rl:${bucket}:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds);
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
