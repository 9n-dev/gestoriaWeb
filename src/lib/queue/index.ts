import 'server-only';
import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { env } from '@/env';

export const QUEUES = { files: 'files' } as const;
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

/** `jobId` makes enqueueing idempotent: the same id is never queued twice. */
export async function enqueue(
  queue: QueueName,
  name: string,
  data: object,
  jobId?: string,
): Promise<void> {
  if (!queues.has(queue)) {
    queues.set(
      queue,
      new Queue(queue, { connection: connection(), defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    );
  }
  await queues.get(queue)!.add(name, data, { jobId });
}

export const createWorker = (queue: QueueName, processor: Processor, concurrency = 4): Worker =>
  new Worker(queue, processor, { connection: connection(), concurrency });
