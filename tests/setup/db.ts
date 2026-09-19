import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

const tables = Prisma.dmmf.datamodel.models.map((m) => `"${m.dbName ?? m.name}"`);

/**
 * Empties every table. DELETE instead of TRUNCATE: on a few rows it is an order of magnitude
 * faster (TRUNCATE rewrites the files of 38 tables and their indexes on every test).
 * `session_replication_role = replica` switches off foreign-key checks and triggers for this
 * transaction only, so order does not matter and the append-only trigger of audit_logs lets go.
 */
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
    ...tables.map((table) => prisma.$executeRawUnsafe(`DELETE FROM ${table}`)),
  ]);
}
