import { env } from '@/env';
import { prisma } from '@/lib/db';
import { deleteTenantData } from '@/modules/gdpr/erasure';

/** The tenants `prisma/seed.ts` creates. Nothing else is ever touched by the reset. */
export const DEMO_TENANT_SLUGS = ['perez', 'otra'];

/**
 * §7: "los datos se reinician cada noche". Deletes the demo tenants for real (rows and bucket) and
 * runs the seed again, so whatever visitors uploaded, changed or registered yesterday is gone.
 */
export async function resetDemo(): Promise<{ reset: string[] }> {
  if (!env.DEMO_MODE)
    throw new Error('resetDemo called without DEMO_MODE: refusing to delete data');

  // Everything: the demo tenants, and whatever gestorías visitors registered during the day.
  // A demo environment holds nobody's real data by definition (README: never run one with DEMO_MODE).
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) await deleteTenantData(tenant.id);

  // Imported on demand: the seed lives outside `src` and is only needed by this job.
  const { seedDemo } = await import('../../../prisma/seed');
  await seedDemo();
  return { reset: tenants.map((tenant) => tenant.slug) };
}
