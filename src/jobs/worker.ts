/**
 * BullMQ worker process (Railway / Fly.io in production, `npm run worker` in development).
 * One file per queue in this folder; every payload is validated with Zod before use.
 * Retries, backoff and dead letters are configured once, in lib/queue.
 */
import { createWorker, QUEUES } from '@/lib/queue';
import { reportError } from '@/lib/report-error';
import { filesProcessor } from './files';
import { registerSchedules, scheduledProcessor } from './scheduled';

const workers = [
  createWorker(QUEUES.files, filesProcessor),
  createWorker(QUEUES.scheduled, scheduledProcessor, 2),
];

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    // Only the last attempt is worth an alert: earlier ones retry with backoff.
    const final = (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
    if (final)
      reportError(error, { where: 'worker', tags: { queue: worker.name, job: job?.name ?? '' } });
    else
      console.error(
        `[worker] ${worker.name}/${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}):`,
        error.message,
      );
  });
}

Promise.all([...workers.map((worker) => worker.waitUntilReady()), registerSchedules()])
  .then(() => console.info(`[worker] ready: ${workers.map((worker) => worker.name).join(', ')}`))
  .catch((error) => {
    console.error('[worker] could not start:', error);
    process.exit(1);
  });

const shutdown = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
