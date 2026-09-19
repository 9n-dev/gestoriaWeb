/**
 * Runs the 04:00 demo reset by hand: `npm run job:demo-reset`. Deletes the demo tenants (rows and
 * bucket) and seeds them again. Refuses to run unless DEMO_MODE=true.
 */
import { prisma } from '@/lib/db';
import { resetDemo } from '@/modules/platform/demo';

resetDemo()
  .then((result) => console.info('[demo-reset]', result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
