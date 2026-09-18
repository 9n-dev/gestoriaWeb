import type { Prisma, PrismaClient } from '@prisma/client';
import holidaysFile from '../data/holidays.json';
import profilesFile from '../data/tax-profiles.json';

/**
 * Reference data shared by every tenant: national holidays and the system tax profile templates.
 * Idempotent. Used by the seed, by the test setup and on deploy.
 */
export async function seedSystemData(prisma: PrismaClient): Promise<void> {
  await prisma.holiday.createMany({
    data: holidaysFile.holidays.map(({ date, name }) => ({
      date: new Date(`${date}T00:00:00.000Z`),
      name,
      scope: 'NATIONAL' as const,
      region: 'ES',
    })),
    skipDuplicates: true,
  });

  for (const { name, description, rules } of profilesFile.profiles) {
    const existing = await prisma.taxProfile.findFirst({ where: { tenantId: null, name } });
    const data = { name, description, rules: rules as Prisma.InputJsonValue };
    if (existing) await prisma.taxProfile.update({ where: { id: existing.id }, data });
    else await prisma.taxProfile.create({ data });
  }
}
