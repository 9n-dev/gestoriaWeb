import { requireArea } from '@/modules/auth/area';
import { getCustomDomain, getSendingDomain } from '@/modules/branding/domains';
import { DomainButtons, DomainForm } from './domain-forms';
import { RecordsTable } from './records-table';

export const dynamic = 'force-dynamic';

export default async function DomainSettingsPage() {
  const user = await requireArea('area.staff');
  const [portal, email] = await Promise.all([
    getCustomDomain(user),
    getSendingDomain(user).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Dominio del portal</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Tus clientes pueden entrar desde tu propio dominio, por ejemplo{' '}
          <code>clientes.tugestoria.es</code>. Guarda el dominio, crea los dos registros en tu
          proveedor de DNS y pulsa «Comprobar ahora». El certificado SSL se emite solo.
        </p>
        {portal ? (
          <>
            <p className="text-sm">
              <strong>{portal.domain}</strong> ·{' '}
              {portal.verified ? 'Verificado y activo' : 'Pendiente de verificar'}
            </p>
            <RecordsTable records={portal.records} caption="Registros DNS que debes crear" />
            <DomainButtons kind="portal" verified={portal.verified} />
          </>
        ) : (
          <DomainForm kind="portal" placeholder="clientes.tugestoria.es" />
        )}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 className="text-xl font-semibold">Dominio de envío de los emails</h2>
        <p className="max-w-2xl text-sm text-fg-muted">
          Para que los correos salgan de <code>no-reply@tugestoria.es</code> y no acaben en spam, tu
          dominio debe autorizar el envío con SPF y DKIM, y conviene publicar una política DMARC.
          Hasta que esté verificado, los correos salen con tu nombre desde la dirección de la
          plataforma.
        </p>
        {email ? (
          <>
            <p className="text-sm">
              <strong>{email.domain}</strong> ·{' '}
              {email.verified
                ? 'Verificado: tus emails ya salen de este dominio'
                : 'Pendiente: recarga esta página para volver a comprobarlo'}
            </p>
            <RecordsTable records={email.records} caption="Registros DNS y su estado" />
            <DomainButtons kind="email" verified={email.verified} />
          </>
        ) : (
          <DomainForm kind="email" placeholder="tugestoria.es" />
        )}
      </section>
    </div>
  );
}
