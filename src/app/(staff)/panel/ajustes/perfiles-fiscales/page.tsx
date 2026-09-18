import Link from 'next/link';
import { requireArea } from '@/modules/auth/area';
import { taxProfileRulesSchema } from '@/modules/clients/tax-profiles/schema';
import { listTaxProfiles } from '@/modules/clients/tax-profiles/service';
import { CloneButton } from './profile-forms';

export default async function TaxProfilesPage() {
  const profiles = await listTaxProfiles(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Perfiles fiscales</h1>
      <p className="max-w-3xl text-sm text-fg-muted">
        El perfil decide qué modelos se generan para cada cliente. Los perfiles del sistema no se
        pueden editar: clónalos y adapta la copia a tu forma de trabajar.
      </p>
      <ul className="flex flex-col gap-2">
        {profiles.map((profile) => {
          const rules = taxProfileRulesSchema.safeParse(profile.rules);
          return (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
            >
              <div>
                <p className="font-medium">
                  {profile.name}{' '}
                  <span className="text-sm font-normal text-fg-muted">
                    {profile.tenantId ? '· Propio' : '· Sistema'}
                  </span>
                </p>
                <p className="text-sm text-fg-muted">
                  Modelos: {rules.success ? rules.data.models.join(', ') : '—'}
                </p>
              </div>
              {profile.tenantId ? (
                <Link
                  href={`/panel/ajustes/perfiles-fiscales/${profile.id}`}
                  className="text-sm underline"
                >
                  Editar
                </Link>
              ) : (
                <CloneButton id={profile.id} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
