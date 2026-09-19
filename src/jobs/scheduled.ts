import type { Job } from 'bullmq';
import { z } from 'zod';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { todayInMadrid } from '@/lib/dates';
import { enqueue, QUEUES, scheduleRepeating } from '@/lib/queue';
import { runTenantDaily } from '@/modules/obligations/reminders/service';
import { runGdprSweep } from '@/modules/gdpr/erasure';
import { runExport } from '@/modules/gdpr/export';
import { runCleanup } from '@/modules/platform/cleanup';
import { resetDemo } from '@/modules/platform/demo';

const tenantDailySchema = z.object({
  tenantId: z.string().min(1),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** 08:00 Europe/Madrid, every day (§6.9). Registered on every worker start; upserts are harmless. */
export async function registerSchedules(): Promise<void> {
  await scheduleRepeating(QUEUES.scheduled, 'daily-0800', '0 8 * * *', 'daily');
  // §7: demo environments start every day from the seed.
  if (env.DEMO_MODE) {
    await scheduleRepeating(QUEUES.scheduled, 'demo-reset-0400', '0 4 * * *', 'demo-reset');
  }
}

/**
 * Queue "scheduled".
 * - daily: fans out one `tenant-daily` per active tenant, so one tenant failing (and retrying)
 *   never delays the others. The date travels in the payload: a retry after midnight still works
 *   for the morning it was scheduled for. Job ids make a double tick harmless.
 * - tenant-daily: reminders, notices and upkeep of one tenant. Idempotent through ReminderLog.
 * - cleanup: platform housekeeping plus the GDPR sweep (erasures and tenant purges that are due,
 *   document retention, expired exports).
 * - demo-reset: 04:00, only with DEMO_MODE: wipes the demo tenants and seeds them again.
 * - export: builds one data export (client or whole tenant) and emails the download link.
 */
export async function scheduledProcessor(job: Job): Promise<unknown> {
  switch (job.name) {
    case 'daily': {
      const today = todayInMadrid();
      const tenants = await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      for (const tenant of tenants) {
        await enqueue(
          QUEUES.scheduled,
          'tenant-daily',
          { tenantId: tenant.id, today },
          `tenant-daily_${tenant.id}_${today}`,
        );
      }
      await enqueue(QUEUES.scheduled, 'cleanup', {}, `cleanup_${today}`);
      // Extraction backlog: documents that were clean before a key was configured, or whose job was lost.
      const backlog = await prisma.document.findMany({
        where: {
          extractionStatus: 'PENDING',
          deletedAt: null,
          file: { status: 'CLEAN' },
          tenant: { status: 'ACTIVE' },
        },
        select: { id: true, tenantId: true },
        take: 500,
      });
      for (const document of backlog) {
        await enqueue(
          QUEUES.files,
          'extract',
          { tenantId: document.tenantId, documentId: document.id },
          `extract_${document.id}_${today}`,
        );
      }
      return { tenants: tenants.length };
    }
    case 'tenant-daily': {
      const { tenantId, today } = tenantDailySchema.parse(job.data);
      return runTenantDaily(tenantId, today);
    }
    case 'cleanup':
      return { ...(await runCleanup()), gdpr: await runGdprSweep() };
    case 'demo-reset':
      return resetDemo();
    case 'export': {
      const { exportId } = z.object({ exportId: z.string().min(1) }).parse(job.data);
      return runExport(exportId);
    }
    default:
      throw new Error(`unknown scheduled job "${job.name}"`);
  }
}
