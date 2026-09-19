import { z } from 'zod';
import { tenantDb } from '@/lib/db';

export const reminderSettingsSchema = z.object({
  enabled: z.boolean().catch(true),
  /** Days before the deadline. 0 = the same day. */
  offsets: z.array(z.number().int().min(0).max(60)).min(1).max(8).catch([15, 7, 2, 0]),
  /** Tell the manager about clients with no activity in this many days. 0 = never. */
  inactivityDays: z.number().int().min(0).max(365).catch(30),
  permanentExpiryOffsets: z
    .array(z.number().int().min(1).max(180))
    .min(1)
    .max(6)
    .catch([60, 30, 7]),
});
/** For the settings form: invalid input is an error, not a silent default. */
export const strictReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  offsets: z
    .array(
      z.number('Los días deben ser números.').int().min(0).max(60, 'Como mucho 60 días antes.'),
    )
    .min(1, 'Indica al menos un aviso.')
    .max(8)
    .transform((offsets) => [...new Set(offsets)].sort((a, b) => b - a)),
  inactivityDays: z.number('Indica un número de días.').int().min(0).max(365),
  permanentExpiryOffsets: z
    .array(z.number().int().min(1).max(180))
    .min(1)
    .max(6)
    .default([60, 30, 7]),
});

export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;
export const parseReminderSettings = (value: unknown): ReminderSettings =>
  reminderSettingsSchema.parse(value && typeof value === 'object' ? value : {});

export type TemplateKey =
  | 'reminder.deadline.15d'
  | 'reminder.deadline.7d'
  | 'reminder.deadline.2d'
  | 'reminder.deadline.0d'
  | 'reminder.inactivity'
  | 'reminder.permanent_expiry';

/** Variables: {{cliente}} {{gestoria}} {{plazo}} {{dias}} {{modelos}} {{pendientes}} {{documento}} {{clientes}} */
export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; body: string }> = {
  'reminder.deadline.15d': {
    subject: 'Se acerca el plazo del {{plazo}}',
    body: 'Hola:\n\nEl {{plazo}} termina el plazo para presentar: {{modelos}}.\n\n{{pendientes}}\n\nTodavía hay tiempo, pero cuanto antes lo tengamos, mejor.\n\n{{gestoria}}',
  },
  'reminder.deadline.7d': {
    subject: 'Queda una semana: plazo del {{plazo}}',
    body: 'Hola:\n\nQuedan {{dias}} días para presentar: {{modelos}}.\n\n{{pendientes}}\n\n{{gestoria}}',
  },
  'reminder.deadline.2d': {
    subject: 'Urgente: el plazo termina el {{plazo}}',
    body: 'Hola:\n\nSolo quedan {{dias}} días para presentar: {{modelos}}.\n\n{{pendientes}}\n\nSi tienes cualquier problema para enviarlo, escríbenos hoy mismo.\n\n{{gestoria}}',
  },
  'reminder.deadline.0d': {
    subject: 'Hoy termina el plazo',
    body: 'Hola:\n\nHoy, {{plazo}}, termina el plazo para presentar: {{modelos}}.\n\n{{pendientes}}\n\n{{gestoria}}',
  },
  'reminder.inactivity': {
    subject: 'Clientes sin actividad',
    body: 'Hola:\n\nEstos clientes llevan más de {{dias}} días sin enviar nada ni escribir:\n\n{{clientes}}\n\nQuizá convenga llamarles.',
  },
  'reminder.permanent_expiry': {
    subject: '«{{documento}}» caduca el {{plazo}}',
    body: 'Hola:\n\nEl documento «{{documento}}» de {{cliente}} caduca el {{plazo}} (quedan {{dias}} días). Conviene renovarlo antes.\n\n{{gestoria}}',
  },
};

/** Custom offsets borrow the wording of the closest default step. */
export const deadlineTemplateKey = (step: number): TemplateKey =>
  step >= 10
    ? 'reminder.deadline.15d'
    : step >= 5
      ? 'reminder.deadline.7d'
      : step >= 1
        ? 'reminder.deadline.2d'
        : 'reminder.deadline.0d';

export const renderTemplate = (text: string, variables: Record<string, string | number>): string =>
  text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(variables[name] ?? ''))
    .replace(/\n{3,}/g, '\n\n');

/** The tenant's own wording when it has edited the template (phase 6 UI), the default otherwise. */
export async function resolveTemplate(
  tenantId: string,
  key: TemplateKey,
): Promise<{ subject: string; body: string }> {
  const override = await tenantDb(tenantId).template.findFirst({
    where: { kind: 'EMAIL', key, locale: 'es' },
  });
  return override
    ? { subject: override.subject ?? DEFAULT_TEMPLATES[key].subject, body: override.body }
    : DEFAULT_TEMPLATES[key];
}
