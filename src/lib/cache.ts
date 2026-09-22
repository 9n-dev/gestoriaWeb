import 'server-only';
import { getRedis } from './redis';

/**
 * Small read-through cache in Redis for numbers that are expensive to compute and fine a minute
 * old (the dashboard). Redis down or a bad entry: compute as if there were no cache.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  let redis;
  try {
    redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
    const hit = await redis.get(`cache:${key}`);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    redis = undefined;
  }
  const value = await compute();
  if (redis)
    await redis.set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
  return value;
}
