import { StaffList } from '@/components/staff-list';
import { requireArea } from '@/modules/auth/area';
import { listStaff } from '@/modules/auth/invitations';
import { InviteStaffForm } from '../forms';

export default async function TeamPage() {
  const staff = await listStaff(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Equipo</h1>
      <StaffList staff={staff} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Invitar a un compañero</h2>
        <InviteStaffForm />
      </section>
    </div>
  );
}
