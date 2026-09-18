import 'server-only';
import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Unscoped client. Only for auth, tenant resolution, platform code and tests. */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name),
);

type Args = Record<string, unknown>;
const asObject = (value: unknown): Args =>
  value && typeof value === 'object' ? (value as Args) : {};

const withTenant = (data: unknown, tenantId: string): Args => ({ ...asObject(data), tenantId });
const withoutTenant = (data: unknown): Args => {
  const { tenantId: _ignored, ...rest } = asObject(data);
  return rest;
};

/**
 * Prisma client bound to one tenant (ADR 0005). `tenantId` must come from the session or the
 * request host, never from user input.
 *
 * - reads, updates and deletes get `tenantId` added to `where` (overriding any supplied value)
 * - creates get `tenantId` forced into `data`; updates cannot change it
 * - models without a `tenantId` column pass through untouched
 *
 * Use scalar foreign keys (`clientId: id`) in `data`: Prisma does not allow mixing them with
 * `connect`. Nested relations are not rewritten, so ids received from the user must first be
 * loaded through this client (which is also what `can()` needs).
 */
export function tenantDb(tenantId: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          const scoped: Args = { ...asObject(args) };
          switch (operation) {
            case 'create':
              scoped.data = withTenant(scoped.data, tenantId);
              break;
            case 'createMany':
            case 'createManyAndReturn':
              scoped.data = (Array.isArray(scoped.data) ? scoped.data : [scoped.data]).map((row) =>
                withTenant(row, tenantId),
              );
              break;
            case 'upsert':
              scoped.where = withTenant(scoped.where, tenantId);
              scoped.create = withTenant(scoped.create, tenantId);
              scoped.update = withoutTenant(scoped.update);
              break;
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
              scoped.where = withTenant(scoped.where, tenantId);
              scoped.data = withoutTenant(scoped.data);
              break;
            default:
              // find*, count, aggregate, groupBy, delete, deleteMany
              scoped.where = withTenant(scoped.where, tenantId);
          }
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
