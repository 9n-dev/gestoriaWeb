import { z } from 'zod';
import { tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { inboxFiltersSchema } from './service';

const savedViewSchema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre a la vista.').max(60),
  filters: inboxFiltersSchema,
});

const INBOX = 'inbox';

/** Saved inbox views are personal (§6.10): filters + order, per user. */
export async function listSavedViews(user: SessionUser) {
  assertCan(user, 'savedView.manage');
  const views = await tenantDb(requireTenantId(user)).savedView.findMany({
    where: { userId: user.id, scope: INBOX },
    orderBy: { name: 'asc' },
  });
  return views.map((view) => ({
    id: view.id,
    name: view.name,
    filters: inboxFiltersSchema.parse(view.filters),
  }));
}

export async function saveView(
  user: SessionUser,
  input: z.input<typeof savedViewSchema>,
): Promise<void> {
  assertCan(user, 'savedView.manage');
  const tenantId = requireTenantId(user);
  const { name, filters } = savedViewSchema.parse(input);
  const db = tenantDb(tenantId);
  const existing = await db.savedView.findFirst({ where: { userId: user.id, scope: INBOX, name } });
  if (existing) await db.savedView.update({ where: { id: existing.id }, data: { filters } });
  else
    await db.savedView.create({ data: { tenantId, userId: user.id, scope: INBOX, name, filters } });
}

export async function deleteSavedView(user: SessionUser, id: string): Promise<void> {
  assertCan(user, 'savedView.manage');
  const { count } = await tenantDb(requireTenantId(user)).savedView.deleteMany({
    where: { id, userId: user.id },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'No encontramos esa vista.');
}
