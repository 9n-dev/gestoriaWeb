import { ROLE, USER_STATUS } from '@/lib/labels';
import type { listStaff } from '@/modules/auth/invitations';

export function StaffList({ staff }: { staff: Awaited<ReturnType<typeof listStaff>> }) {
  return (
    <table className="w-full max-w-3xl border-collapse text-left text-sm">
      <caption className="sr-only">Equipo de la gestoría</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pr-4 font-medium">
            Nombre
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Correo
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Rol
          </th>
          <th scope="col" className="py-2 font-medium">
            Estado
          </th>
        </tr>
      </thead>
      <tbody>
        {staff.map((person) => (
          <tr key={person.id} className="border-b border-border">
            <td className="py-2 pr-4">{person.name}</td>
            <td className="py-2 pr-4">{person.email}</td>
            <td className="py-2 pr-4">{ROLE[person.role]}</td>
            <td className="py-2">{USER_STATUS[person.status]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
