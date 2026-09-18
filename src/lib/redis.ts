import 'server-only';
import Redis from 'ioredis';
import { env } from '@/env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Shared connection. BullMQ queues (phase 4) create their own from the same URL. */
export function getRedis(): Redis {
  return (globalForRedis.redis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  }));
}

export async function pingRedis(): Promise<void> {
  const redis = getRedis();
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  await redis.ping();
}
