/**
 * Runs the morning job by hand, without waiting for 08:00: `npm run job:daily -- 2026-10-13`.
 * Same code path as the scheduled job, so it is just as idempotent. Useful for demos and support.
 */
import { prisma } from '@/lib/db';
import { todayInMadrid } from '@/lib/dates';
import { runTenantDaily } from '@/modules/obligations/reminders/service';

async function main() {
  const today = process.argv[2] ?? todayInMadrid();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error('Usage: npm run job:daily -- [YYYY-MM-DD]');
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, slug: true },
  });
  for (const tenant of tenants) {
    console.info(`[daily ${today}] ${tenant.slug}:`, await runTenantDaily(tenant.id, today));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
