import 'server-only';
import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { env } from '@/env';

export const QUEUES = { files: 'files', scheduled: 'scheduled' } as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// BullMQ needs its own connections (blocking commands): never the shared client of lib/redis.ts.
const connection = () => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
};

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  // Failed jobs stay: they are the dead-letter list the superadmin panel reads (phase 4).
  removeOnFail: false,
};

const globalForQueues = globalThis as unknown as { queues?: Map<string, Queue> };
const queues = (globalForQueues.queues ??= new Map());

export function getQueue(queue: QueueName): Queue {
  if (!queues.has(queue)) {
    queues.set(
      queue,
      new Queue(queue, { connection: connection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    );
  }
  return queues.get(queue)!;
}

/** `jobId` makes enqueueing idempotent: the same id is never queued twice. It cannot contain ":". */
export async function enqueue(
  queue: QueueName,
  name: string,
  data: object,
  jobId?: string,
): Promise<void> {
  await getQueue(queue).add(name, data, { jobId });
}

/** Cron-like repeating job. Upsert: safe to call on every worker start. */
export async function scheduleRepeating(
  queue: QueueName,
  schedulerId: string,
  pattern: string,
  name: string,
): Promise<void> {
  await getQueue(queue).upsertJobScheduler(schedulerId, { pattern, tz: 'Europe/Madrid' }, { name });
}

export const createWorker = (queue: QueueName, processor: Processor, concurrency = 4): Worker =>
  new Worker(queue, processor, { connection: connection(), concurrency });
