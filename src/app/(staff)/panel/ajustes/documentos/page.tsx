import { requireArea } from '@/modules/auth/area';
import { getRejectionReasons } from '@/modules/documents/service';
import { ReasonsForm } from './reasons-form';

export default async function DocumentSettingsPage() {
  const user = await requireArea('area.staff');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Documentos</h1>
      <p className="max-w-2xl text-sm text-fg-muted">
        Al rechazar un documento, el gestor elige uno de estos motivos y el cliente lo recibe al
        momento. Escríbelos pensando en quien los va a leer.
      </p>
      <ReasonsForm reasons={await getRejectionReasons(user.tenantId!)} />
    </div>
  );
}
