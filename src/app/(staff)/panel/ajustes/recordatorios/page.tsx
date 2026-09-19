import { requireArea } from '@/modules/auth/area';
import { parseReminderSettings } from '@/modules/obligations/reminders/templates';
import { getOwnTenant } from '@/modules/tenants/service';
import { RemindersForm } from './reminders-form';

export default async function ReminderSettingsPage() {
  const tenant = await getOwnTenant(await requireArea('area.staff'));
  const settings = parseReminderSettings(tenant.reminderSettings);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Recordatorios</h1>
      <p className="max-w-2xl text-sm text-fg-muted">
        Cada mañana a las 8:00 avisamos a tus clientes de los plazos que se acercan y de la
        documentación concreta que les falta: un solo mensaje por cliente y día. También avisamos de
        los documentos permanentes que caducan (60, 30 y 7 días antes).
      </p>
      <RemindersForm
        enabled={settings.enabled}
        offsets={settings.offsets}
        inactivityDays={settings.inactivityDays}
      />
    </div>
  );
}
