import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { renderEmailHtml } from '@/lib/email/html';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  type TemplateKey,
} from '@/modules/obligations/reminders/templates';
import { parseBranding } from '@/modules/tenants/schema';

/** The wrapper of every notification email: what happened, the detail, where to see it. */
const NOTIFICATION_VARIABLES = ['nombre', 'titulo', 'detalle', 'enlace', 'gestoria'];

/** What the editor shows for each system email, and the sample data of its preview. */
export const EMAIL_TEMPLATE_INFO: Record<TemplateKey, { label: string; variables: string[] }> = {
  'auth.invitation': { label: 'Invitación al portal', variables: ['nombre', 'gestoria', 'enlace'] },
  'auth.magic_link': { label: 'Enlace de acceso', variables: ['nombre', 'gestoria', 'enlace'] },
  'reminder.deadline.15d': {
    label: 'Recordatorio de plazo · 15 días',
    variables: ['cliente', 'plazo', 'dias', 'modelos', 'pendientes', 'gestoria'],
  },
  'reminder.deadline.7d': {
    label: 'Recordatorio de plazo · 7 días',
    variables: ['cliente', 'plazo', 'dias', 'modelos', 'pendientes', 'gestoria'],
  },
  'reminder.deadline.2d': {
    label: 'Recordatorio de plazo · 2 días',
    variables: ['cliente', 'plazo', 'dias', 'modelos', 'pendientes', 'gestoria'],
  },
  'reminder.deadline.0d': {
    label: 'Recordatorio de plazo · el mismo día',
    variables: ['cliente', 'plazo', 'modelos', 'pendientes', 'gestoria'],
  },
  'reminder.inactivity': {
    label: 'Aviso al gestor: clientes sin actividad',
    variables: ['dias', 'clientes'],
  },
  'reminder.permanent_expiry': {
    label: 'Documento permanente a punto de caducar',
    variables: ['documento', 'cliente', 'plazo', 'dias', 'gestoria'],
  },
  'notification.generic': { label: 'Avisos: texto común', variables: NOTIFICATION_VARIABLES },
  'notification.document_received': {
    label: 'Aviso: documento recibido',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.document_rejected': {
    label: 'Aviso: documento rechazado',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.obligation_filed': {
    label: 'Aviso: impuesto presentado',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.new_message': { label: 'Aviso: nuevo mensaje', variables: NOTIFICATION_VARIABLES },
  'notification.mention': {
    label: 'Aviso: mención de un compañero',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.delivery_available': {
    label: 'Aviso: nueva entrega',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.signature_requested': {
    label: 'Aviso: documento por firmar',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.invoice_issued': {
    label: 'Aviso: factura emitida',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.invoice_overdue': {
    label: 'Aviso: factura vencida',
    variables: NOTIFICATION_VARIABLES,
  },
  'notification.permanent_doc_expiring': {
    label: 'Aviso: documento a punto de caducar',
    variables: NOTIFICATION_VARIABLES,
  },
};

const SAMPLE = {
  nombre: 'Marta Soler',
  cliente: 'Marta Soler Vidal',
  plazo: '20 de octubre de 2026',
  dias: 7,
  modelos: '303 (3T 2026), 130 (3T 2026)',
  pendientes:
    'Para prepararlo todavía nos falta de 3T 2026:\n- Facturas emitidas\n- Recibos del alquiler del local',
  documento: 'Certificado digital',
  clientes: '- Reformas Turia, S.L.\n- Bicis Malvarrosa, S.L.',
  enlace: 'https://clientes.tugestoria.es/acceso/enlace?token=ejemplo',
  titulo: 'Hemos recibido tu documento',
  detalle: 'factura-luz-agosto.pdf ya está en manos de tu gestor.',
};

const keys = Object.keys(EMAIL_TEMPLATE_INFO) as [TemplateKey, ...TemplateKey[]];
const inputSchema = z.object({
  key: z.enum(keys),
  subject: z.string().trim().min(3, 'Escribe el asunto.').max(200),
  body: z.string().trim().min(10, 'Escribe el texto del email.').max(5000),
});

export async function listEmailTemplates(user: SessionUser) {
  assertCan(user, 'template.manage');
  const overrides = await tenantDb(requireTenantId(user)).template.findMany({
    where: { kind: 'EMAIL', locale: 'es' },
  });
  return keys.map((key) => {
    const override = overrides.find((template) => template.key === key);
    return {
      key,
      ...EMAIL_TEMPLATE_INFO[key],
      subject: override?.subject ?? DEFAULT_TEMPLATES[key].subject,
      body: override?.body ?? DEFAULT_TEMPLATES[key].body,
      customized: Boolean(override),
    };
  });
}

/** Renders subject, text and branded HTML with sample data, exactly as it would be sent (§6.12). */
export async function previewEmailTemplate(user: SessionUser, input: z.input<typeof inputSchema>) {
  assertCan(user, 'template.manage');
  const { subject, body } = inputSchema.parse(input);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: requireTenantId(user) } });
  const variables = { ...SAMPLE, gestoria: tenant.name };
  const branding = parseBranding(tenant.branding);
  const text = renderTemplate(body, variables);
  return {
    subject: renderTemplate(subject, variables),
    text,
    html: renderEmailHtml(text, {
      tenantName: tenant.name,
      primaryColor: branding.primaryColor ?? '#1d4ed8',
      logoUrl: branding.logoFileId ? '/api/branding/logo' : undefined,
    }),
  };
}

export async function saveEmailTemplate(
  user: SessionUser,
  input: z.input<typeof inputSchema>,
): Promise<void> {
  assertCan(user, 'template.manage');
  const tenantId = requireTenantId(user);
  const { key, subject, body } = inputSchema.parse(input);
  const unknown = [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1]!)
    .filter((name) => !EMAIL_TEMPLATE_INFO[key].variables.includes(name));
  if (unknown.length)
    throw new AppError('VALIDATION', `Esta plantilla no admite la variable {{${unknown[0]}}}.`);

  const db = tenantDb(tenantId);
  const existing = await db.template.findFirst({ where: { kind: 'EMAIL', key, locale: 'es' } });
  const data = { subject, body, name: EMAIL_TEMPLATE_INFO[key].label };
  if (existing) await db.template.update({ where: { id: existing.id }, data });
  else await db.template.create({ data: { tenantId, kind: 'EMAIL', key, locale: 'es', ...data } });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'emailTemplate.save',
    entity: 'Template',
    diff: { key },
  });
}

/** Back to the default wording. */
export async function resetEmailTemplate(user: SessionUser, key: string): Promise<void> {
  assertCan(user, 'template.manage');
  const tenantId = requireTenantId(user);
  await tenantDb(tenantId).template.deleteMany({
    where: { kind: 'EMAIL', key: z.enum(keys).parse(key) },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'emailTemplate.reset',
    entity: 'Template',
    diff: { key },
  });
}
