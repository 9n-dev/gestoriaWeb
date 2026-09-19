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

/** Dead letters (§6.9): jobs that exhausted their retries stay in BullMQ's failed set. */
export async function listFailedJobs(user: SessionUser): Promise<FailedJob[]> {
  assertCan(user, 'platform.jobs.viewFailed');
  const lists = await Promise.all(
    Object.values(QUEUES).map(async (queue) =>
      (await getQueue(queue).getFailed(0, 99)).map((job) => describe(queue, job)),
    ),
  );
  return lists.flat().sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''));
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
