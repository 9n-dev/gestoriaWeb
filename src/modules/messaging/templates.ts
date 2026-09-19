import { z } from 'zod';
import { tenantDb } from '@/lib/db';
import { formatLongDate, isoDate, toDateOnly, todayInMadrid } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { getClientChecklist } from '@/modules/checklists/service';
import { loadForStaff } from '@/modules/clients/service';
import { renderTemplate } from '@/modules/obligations/reminders/templates';

const templateSchema = z.object({
  name: z.string().trim().min(2, 'Ponle un nombre a la plantilla.').max(80),
  body: z.string().trim().min(5, 'Escribe el texto de la plantilla.').max(5000),
});

const MESSAGE = { kind: 'MESSAGE' as const };

/** Canned replies of the gestoría (§6.8). Variables: {{cliente}} {{plazo}} {{pendientes}}. */
export async function listMessageTemplates(user: SessionUser) {
  assertCan(user, 'messageTemplate.use');
  return tenantDb(requireTenantId(user)).template.findMany({
    where: MESSAGE,
    select: { id: true, name: true, body: true },
    orderBy: { name: 'asc' },
  });
}

export async function saveMessageTemplate(
  user: SessionUser,
  input: z.input<typeof templateSchema>,
  id?: string,
): Promise<void> {
  assertCan(user, 'template.manage');
  const tenantId = requireTenantId(user);
  const data = templateSchema.parse(input);
  const db = tenantDb(tenantId);
  if (id) {
    const { count } = await db.template.updateMany({ where: { id, ...MESSAGE }, data });
    if (count === 0) throw new AppError('NOT_FOUND', 'No encontramos esa plantilla.');
  } else {
    await db.template.create({ data: { tenantId, ...MESSAGE, ...data } });
  }
  await recordAudit({
    tenantId,
    actor: user,
    action: id ? 'template.update' : 'template.create',
    entity: 'Template',
    entityId: id,
    diff: { name: data.name },
  });
}

export async function deleteMessageTemplate(user: SessionUser, id: string): Promise<void> {
  assertCan(user, 'template.manage');
  const tenantId = requireTenantId(user);
  const { count } = await tenantDb(tenantId).template.deleteMany({ where: { id, ...MESSAGE } });
  if (count === 0) throw new AppError('NOT_FOUND', 'No encontramos esa plantilla.');
  await recordAudit({
    tenantId,
    actor: user,
    action: 'template.delete',
    entity: 'Template',
    entityId: id,
  });
}

/** The template filled in for one client: name, next deadline and what is still missing. */
export async function renderMessageTemplate(
  user: SessionUser,
  templateId: string,
  clientId: string,
): Promise<string> {
  assertCan(user, 'messageTemplate.use');
  const client = await loadForStaff(user, clientId);
  const db = tenantDb(client.tenantId);
  const template = await db.template.findFirst({ where: { id: templateId, ...MESSAGE } });
  if (!template) throw new AppError('NOT_FOUND', 'No encontramos esa plantilla.');

  const today = todayInMadrid();
  const [next, checklist] = await Promise.all([
    db.obligation.findFirst({
      where: { clientId, status: { not: 'FILED' }, dueDate: { gte: toDateOnly(today) } },
      orderBy: { dueDate: 'asc' },
      select: { dueDate: true },
    }),
    getClientChecklist(user, clientId, { today }),
  ]);
  return renderTemplate(template.body, {
    cliente: client.legalName,
    plazo: next ? formatLongDate(isoDate(next.dueDate)) : '(sin plazos próximos)',
    pendientes: checklist?.missing.length
      ? checklist.missing.map((label) => `- ${label}`).join('\n')
      : '(nada pendiente)',
  });
}
