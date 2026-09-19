import { Prisma, type ObligationStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { addDays, isoDate, toDateOnly, todayInMadrid, type IsoDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { periodLabel } from '@/lib/labels';
import { formatEuros } from '@/lib/money';
import { recordAudit } from '@/modules/audit/service';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { notifyClientUsers } from '@/modules/messaging/notifications';
import { getTaxCalendar, knownModels } from './calendar';
import { computeDueDate } from './deadlines';

const obligationSelect = {
  id: true,
  tenantId: true,
  clientId: true,
  model: true,
  dueDate: true,
  status: true,
  estimatedAmount: true,
  result: true,
  resultAmount: true,
  directDebit: true,
  filedAt: true,
  period: { select: { year: true, type: true, ordinal: true } },
  receiptFile: { select: { id: true, originalName: true, status: true, deletedAt: true } },
  client: { select: { id: true, legalName: true, assignedManagerId: true, status: true } },
} satisfies Prisma.ObligationSelect;

export type ObligationRow = Prisma.ObligationGetPayload<{ select: typeof obligationSelect }>;

const resource = (o: ObligationRow): Resource => ({
  tenantId: o.tenantId,
  clientId: o.clientId,
  assignedManagerId: o.client.assignedManagerId,
  clientStatus: o.client.status,
});

const notFound = () => new AppError('NOT_FOUND', 'No encontramos esa obligación.');

async function load(user: SessionUser, id: string): Promise<ObligationRow> {
  const obligation = await tenantDb(requireTenantId(user)).obligation.findFirst({
    where: { id },
    select: obligationSelect,
  });
  if (!obligation || !can(user, 'obligation.read', resource(obligation))) throw notFound();
  return obligation;
}

async function loadForUpdate(user: SessionUser, id: string): Promise<ObligationRow> {
  const obligation = await load(user, id);
  assertCan(user, 'obligation.update', resource(obligation));
  return obligation;
}

async function update(
  user: SessionUser,
  obligation: ObligationRow,
  action: string,
  data: Prisma.ObligationUncheckedUpdateInput,
): Promise<void> {
  await tenantDb(obligation.tenantId).obligation.update({ where: { id: obligation.id }, data });
  await recordAudit({
    tenantId: obligation.tenantId,
    actor: user,
    action: `obligation.${action}`,
    entity: 'Obligation',
    entityId: obligation.id,
    diff: { model: obligation.model, before: obligation.status, ...(data as Prisma.JsonObject) },
  });
}

// ─────────────────────────── Reading ───────────────────────────

/** Obligations of one client, soonest first (client portal and client file). */
export async function listClientObligations(
  user: SessionUser,
  clientId: string,
): Promise<ObligationRow[]> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'obligation.read', resourceOf(client));
  return tenantDb(client.tenantId).obligation.findMany({
    where: { clientId },
    select: obligationSelect,
    orderBy: [{ dueDate: 'asc' }, { model: 'asc' }],
  });
}

export const upcomingFiltersSchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  managerId: z.string().optional(),
  status: z.enum(['PENDING_DOCS', 'IN_PROGRESS', 'FILED']).optional(),
  model: z.string().optional(),
  includeOverdue: z.boolean().default(true),
});
export type UpcomingFilters = z.input<typeof upcomingFiltersSchema>;

/** Tenant-wide filing calendar: what is due in the next N days (and what is late), by scope. */
export async function listUpcomingObligations(
  user: SessionUser,
  filters: UpcomingFilters = {},
  today: IsoDate = todayInMadrid(),
): Promise<ObligationRow[]> {
  assertCan(user, 'obligation.update');
  const { days, managerId, status, model, includeOverdue } = upcomingFiltersSchema.parse(filters);
  const ownOnly = scopeFor(user, 'obligation.update') === 'assigned';
  const until = toDateOnly(addDays(today, days));

  return tenantDb(requireTenantId(user)).obligation.findMany({
    where: {
      model,
      client: { deletedAt: null, assignedManagerId: ownOnly ? user.id : managerId },
      OR: [
        { dueDate: { gte: toDateOnly(today), lte: until }, status },
        ...(includeOverdue && (!status || status !== 'FILED')
          ? [
              {
                dueDate: { lt: toDateOnly(today) },
                status: status ?? { not: 'FILED' as ObligationStatus },
              },
            ]
          : []),
      ],
    },
    select: obligationSelect,
    orderBy: [{ dueDate: 'asc' }, { model: 'asc' }],
    take: 500,
  });
}

// ─────────────────────────── Workflow: PENDING_DOCS → IN_PROGRESS → FILED ───────────────────────────

export async function startObligation(user: SessionUser, id: string): Promise<void> {
  const obligation = await loadForUpdate(user, id);
  if (obligation.status !== 'PENDING_DOCS')
    throw new AppError('CONFLICT', 'Esta obligación ya está en curso o presentada.');
  await update(user, obligation, 'start', { status: 'IN_PROGRESS' });
}

const amountSchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value.trim() === ''
        ? null
        : Number(value.replace(/\./g, '').replace(',', '.'))
      : value,
  z
    .number('Importe no válido.')
    .finite()
    .min(0, 'El importe no puede ser negativo.')
    .max(99_999_999)
    .nullable(),
);

/** "Importe previsto" shown to the client before the filing (§6.6). */
export async function setEstimate(user: SessionUser, id: string, amount: unknown): Promise<void> {
  const obligation = await loadForUpdate(user, id);
  await update(user, obligation, 'setEstimate', { estimatedAmount: amountSchema.parse(amount) });
}

export const filingSchema = z
  .object({
    result: z.enum(['TO_PAY', 'TO_REFUND', 'ZERO'], 'Indica el resultado.'),
    amount: amountSchema,
    directDebit: z.boolean().default(false),
  })
  .transform((filing) =>
    filing.result === 'ZERO' ? { ...filing, amount: 0, directDebit: false } : filing,
  )
  .refine((filing) => filing.amount !== null && (filing.result === 'ZERO' || filing.amount > 0), {
    message: 'Indica el importe.',
    path: ['amount'],
  });

/** Marks the form as filed with its outcome; the receipt is uploaded separately. The client is told at once. */
export async function fileObligation(
  user: SessionUser,
  id: string,
  input: z.input<typeof filingSchema>,
): Promise<void> {
  const obligation = await loadForUpdate(user, id);
  const { result, amount, directDebit } = filingSchema.parse(input);
  await update(user, obligation, 'file', {
    status: 'FILED',
    result,
    resultAmount: amount,
    directDebit,
    filedAt: new Date(),
    filedById: user.id,
  });

  const outcome =
    result === 'ZERO'
      ? 'Resultado: sin importe a pagar ni a devolver.'
      : result === 'TO_PAY'
        ? `Resultado: a pagar ${formatEuros(amount!)}. ${directDebit ? 'Está domiciliado: se cargará en tu cuenta.' : 'No está domiciliado: recuerda hacer el pago antes de que acabe el plazo.'}`
        : `Resultado: a devolver ${formatEuros(amount!)}.`;
  await notifyClientUsers(obligation.tenantId, obligation.clientId, {
    type: 'OBLIGATION_FILED',
    title: `Hemos presentado tu modelo ${obligation.model} (${periodLabel(obligation.period)})`,
    body: outcome,
    link: '/plazos',
  });
}

/** Back to "in progress", e.g. to file a corrected return. The previous outcome stays until overwritten. */
export async function reopenObligation(user: SessionUser, id: string): Promise<void> {
  const obligation = await loadForUpdate(user, id);
  if (obligation.status !== 'FILED')
    throw new AppError('CONFLICT', 'Esta obligación no está presentada.');
  await update(user, obligation, 'reopen', {
    status: 'IN_PROGRESS',
    filedAt: null,
    filedById: null,
  });
}

// ─────────────────────────── Manual obligations (outside the tax profile) ───────────────────────────

const manualSchema = z.object({
  model: z
    .string()
    .refine(
      (model) => knownModels().includes(model),
      'Ese modelo no está en el calendario fiscal.',
    ),
  period: z.object({
    year: z.number().int(),
    type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
    ordinal: z.number().int(),
  }),
});

/** One-off obligation the profile does not generate. The deadline still comes from the AEAT calendar. */
export async function createObligation(
  user: SessionUser,
  clientId: string,
  input: z.input<typeof manualSchema>,
): Promise<void> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'obligation.update', resourceOf(client));
  const { model, period } = manualSchema.parse(input);

  const nominal = getTaxCalendar(period.year)?.models[model]?.periods[period.type]?.find(
    (p) => p.ordinal === period.ordinal,
  )?.due;
  if (!nominal)
    throw new AppError('VALIDATION', `El modelo ${model} no se presenta en ese periodo.`);
  const holidays = await prisma.holiday.findMany({
    where: { scope: 'NATIONAL' },
    select: { date: true },
  });
  const dueDate = computeDueDate(nominal, new Set(holidays.map((h) => isoDate(h.date))));

  const { id: periodId } = await prisma.period.upsert({
    where: { year_type_ordinal: period },
    create: period,
    update: {},
  });
  try {
    const created = await tenantDb(client.tenantId).obligation.create({
      data: { tenantId: client.tenantId, clientId, model, periodId, dueDate: toDateOnly(dueDate) },
    });
    await recordAudit({
      tenantId: client.tenantId,
      actor: user,
      action: 'obligation.create',
      entity: 'Obligation',
      entityId: created.id,
      diff: { model, period, dueDate },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'Ese cliente ya tiene esa obligación.');
    }
    throw error;
  }
}

/** Only obligations nobody has started can be removed. */
export async function deleteObligation(user: SessionUser, id: string): Promise<void> {
  const obligation = await loadForUpdate(user, id);
  if (obligation.status !== 'PENDING_DOCS') {
    throw new AppError('CONFLICT', 'Solo se pueden eliminar obligaciones que no se han empezado.');
  }
  await tenantDb(obligation.tenantId).obligation.delete({ where: { id } });
  await recordAudit({
    tenantId: obligation.tenantId,
    actor: user,
    action: 'obligation.delete',
    entity: 'Obligation',
    entityId: id,
    diff: { model: obligation.model },
  });
}
