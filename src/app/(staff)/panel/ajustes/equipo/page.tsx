import { requireArea } from '@/modules/auth/area';
import { listStaff } from '@/modules/auth/invitations';
import { InviteStaffForm, ResetTwoFactorForm } from '../forms';
import { TeamTable } from './team-table';

export default async function TeamPage() {
  const user = await requireArea('area.staff');
  const staff = await listStaff(user);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Equipo</h1>
      <TeamTable staff={staff} currentUserId={user.id} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Invitar a un compañero</h2>
        <InviteStaffForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">¿Alguien ha perdido el móvil?</h2>
        <p className="max-w-prose text-sm text-fg-muted">
          Si tampoco conserva sus códigos de recuperación, restablece su verificación en dos pasos:
          cerramos sus sesiones y la configurará de nuevo la próxima vez que entre.
        </p>
        <ResetTwoFactorForm staff={staff.filter((person) => person.id !== user.id)} />
      </section>
    </div>
  );
}
