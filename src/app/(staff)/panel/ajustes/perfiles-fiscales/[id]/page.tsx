import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireArea } from '@/modules/auth/area';
import { taxProfileRulesSchema } from '@/modules/clients/tax-profiles/schema';
import { getTaxProfile } from '@/modules/clients/tax-profiles/service';
import { knownModels, modelName } from '@/modules/obligations/calendar';
import { ArchiveButton, TaxProfileForm } from '../profile-forms';

export default async function EditTaxProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.staff');
  const profile = await getTaxProfile(user, (await params).id).catch(() => notFound());
  const rules = taxProfileRulesSchema.safeParse(profile.rules);
  if (!profile.tenantId || !rules.success) notFound();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">
        <Link href="/panel/ajustes/perfiles-fiscales" className="underline">
          Perfiles fiscales
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{profile.name}</h1>
      <TaxProfileForm
        id={profile.id}
        name={profile.name}
        description={profile.description ?? ''}
        rules={rules.data}
        models={knownModels().map((model) => ({ model, name: modelName(model) }))}
      />
      <ArchiveButton id={profile.id} />
    </div>
  );
}
