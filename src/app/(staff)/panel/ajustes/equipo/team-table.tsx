'use client';

import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import { ROLE, USER_STATUS } from '@/lib/labels';
import type { listStaff } from '@/modules/auth/invitations';
import { disableStaffAction, enableStaffAction, setStaffRoleAction } from '../actions';

type Staff = Awaited<ReturnType<typeof listStaff>>;
const STAFF_ROLES = ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] as const;

function Manage({ person, heirs }: { person: Staff[number]; heirs: Staff }) {
  const clients = person._count.assignedClients;
  if (person.status === 'DISABLED') {
    return (
      <ActionForm action={enableStaffAction.bind(null, person.id)}>
        <SubmitButton variant="secondary" pendingLabel="Reactivando…">
          Reactivar
        </SubmitButton>
      </ActionForm>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer rounded-md px-2 py-1 underline-offset-4 hover:underline">
        Gestionar<span className="sr-only"> a {person.name}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-5 rounded-md border border-border p-3">
        <ActionForm action={setStaffRoleAction.bind(null, person.id)}>
          <SelectField label="Rol" name="role" id={`role-${person.id}`} defaultValue={person.role}>
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE[role]}
              </option>
            ))}
          </SelectField>
          <SubmitButton variant="secondary">Cambiar rol</SubmitButton>
        </ActionForm>

        <ActionForm action={disableStaffAction.bind(null, person.id)}>
          <p className="max-w-prose text-sm text-fg-muted">
            Dar de baja cierra sus sesiones y le impide entrar. Lo que hizo (documentos, mensajes,
            auditoría) se conserva con su nombre.
          </p>
          {clients > 0 && (
            <SelectField
              label={`Sus ${clients} ${clients === 1 ? 'cliente pasa' : 'clientes pasan'} a`}
              name="reassignToId"
              id={`heir-${person.id}`}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Elige a una persona
              </option>
              {heirs
                .filter((heir) => heir.id !== person.id && heir.status !== 'DISABLED')
                .map((heir) => (
                  <option key={heir.id} value={heir.id}>
                    {heir.name}
                  </option>
                ))}
            </SelectField>
          )}
          <SubmitButton variant="secondary" pendingLabel="Dando de baja…">
            Dar de baja
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

export function TeamTable({ staff, currentUserId }: { staff: Staff; currentUserId: string }) {
  return (
    <table className="w-full max-w-4xl border-collapse text-left text-sm">
      <caption className="sr-only">Equipo de la gestoría</caption>
      <thead>
        <tr className="border-b border-border">
          {['Nombre', 'Correo', 'Rol', 'Estado', 'Clientes'].map((heading) => (
            <th key={heading} scope="col" className="py-2 pr-4 font-medium">
              {heading}
            </th>
          ))}
          <th scope="col" className="py-2 font-medium">
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {staff.map((person) => (
          <tr key={person.id} className="border-b border-border align-top">
            <td className="py-2 pr-4">{person.name}</td>
            <td className="py-2 pr-4">{person.email}</td>
            <td className="py-2 pr-4">{ROLE[person.role]}</td>
            <td className="py-2 pr-4">{USER_STATUS[person.status]}</td>
            <td className="py-2 pr-4">{person._count.assignedClients}</td>
            <td className="py-2">
              {person.id === currentUserId ? (
                <span className="text-fg-muted">Tú</span>
              ) : (
                <Manage person={person} heirs={staff} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
