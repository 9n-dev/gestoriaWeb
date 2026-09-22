import type { Job } from 'bullmq';
import { AppError } from '@/lib/errors';
import { getQueue, QUEUES, type QueueName } from '@/lib/queue';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';

export type FailedJob = {
  queue: QueueName;
  id: string;
  name: string;
  reason: string;
  attempts: number;
  failedAt: string | null;
  /** Identifiers only: superadmins never see tenant data through job payloads (§4). */
  data: Record<string, string>;
};

/** Keeps ids and dates, drops everything else. */
export function redactJobData(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => typeof value === 'string' && /(Id|^today)$/.test(key))
      .map(([key, value]) => [key, String(value)]),
  );
}

const describe = (queue: QueueName, job: Job): FailedJob => ({
  queue,
  id: job.id ?? '',
  name: job.name,
  reason: (job.failedReason ?? '').slice(0, 300),
  attempts: job.attemptsMade,
  failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  data: redactJobData(job.data),
});

export const FAILED_PAGE_SIZE = 50;

/** Dead letters (§6.9): jobs that exhausted their retries stay in BullMQ's failed set. One page across all queues. */
export async function listFailedJobs(
  user: SessionUser,
  page = 1,
): Promise<{ jobs: FailedJob[]; total: number; page: number; pages: number }> {
  assertCan(user, 'platform.jobs.viewFailed');
  const queues = Object.values(QUEUES).map((queue) => getQueue(queue));
  const counts = await Promise.all(queues.map((queue) => queue.getFailedCount()));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const pages = Math.max(1, Math.ceil(total / FAILED_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  // Merge the queues' failed lists (newest first each) and take the page from the merged order.
  // ponytail: fetches every failed job of every queue to sort them; fine below a few thousand dead letters.
  const lists = await Promise.all(
    queues.map(async (queue, index) =>
      (await queue.getFailed(0, Math.max(0, counts[index]! - 1))).map((job) =>
        describe(Object.values(QUEUES)[index]!, job),
      ),
    ),
  );
  const all = lists.flat().sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''));
  return {
    jobs: all.slice((current - 1) * FAILED_PAGE_SIZE, current * FAILED_PAGE_SIZE),
    total,
    page: current,
    pages,
  };
}

/** "Reintentar todos": every dead letter of every queue goes back to waiting. Returns how many. */
export async function retryAllFailedJobs(user: SessionUser): Promise<number> {
  assertCan(user, 'platform.jobs.retry');
  let retried = 0;
  for (const name of Object.values(QUEUES)) {
    const queue = getQueue(name);
    const jobs = await queue.getFailed(0, -1);
    for (const job of jobs) {
      await job.retry().catch(() => undefined); // already picked up by somebody else: fine
      retried++;
    }
  }
  await recordAudit({
    tenantId: null,
    actor: user,
    action: 'platform.jobs.retryAll',
    entity: 'Job',
    entityId: 'all',
    diff: { retried },
  });
  return retried;
}

export async function retryFailedJob(
  user: SessionUser,
  queue: string,
  jobId: string,
): Promise<void> {
  assertCan(user, 'platform.jobs.retry');
  if (!Object.values(QUEUES).includes(queue as QueueName))
    throw new AppError('NOT_FOUND', 'Esa cola no existe.');
  const job = await getQueue(queue as QueueName).getJob(jobId);
  if (!job || !(await job.isFailed()))
    throw new AppError('NOT_FOUND', 'Ese job ya no está en la lista de fallidos.');
  await job.retry();
  await recordAudit({
    tenantId: null,
    actor: user,
    action: 'platform.jobs.retry',
    entity: 'Job',
    entityId: `${queue}/${jobId}`,
  });
}
