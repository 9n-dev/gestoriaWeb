import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatLongDate, isoDate } from '@/lib/dates';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { deliveryResource } from '@/modules/deliveries/access';
import { getDelivery } from '@/modules/deliveries/service';
import { SignForm } from './sign-form';

export default async function ClientDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.client');
  const delivery = await getDelivery(user, (await params).id).catch(() => notFound());
  const ready = delivery.file.status === 'CLEAN';
  const canDownload = can(user, 'delivery.download', {
    ...deliveryResource(delivery),
    fileStatus: delivery.file.status,
  });
  const src = `/api/files/${delivery.file.id}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-fg-muted">
          <Link href="/entregas" className="underline">
            Documentos
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{delivery.title}</h1>
        <p className="text-sm text-fg-muted">{formatLongDate(isoDate(delivery.visibleFrom))}</p>
      </div>

      {!ready ? (
        <p className="text-fg-muted">El documento se está preparando. Vuelve en unos segundos.</p>
      ) : !canDownload ? (
        <p className="rounded-md bg-surface-muted p-3 text-sm">
          Tienes facturas pendientes con la gestoría: mientras tanto no puedes descargar documentos.
          Escríbenos si crees que es un error.
        </p>
      ) : (
        <>
          {delivery.file.mimeType === 'application/pdf' ? (
            <iframe
              src={`${src}?inline`}
              title={`Documento: ${delivery.title}`}
              className="h-[60vh] w-full rounded-md border border-border"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind our own route
            <img
              src={`${src}?inline`}
              alt={delivery.title}
              className="max-h-[60vh] w-full rounded-md border border-border object-contain"
            />
          )}
          <a href={src} className="self-start text-sm underline">
            Descargar
          </a>
        </>
      )}

      {delivery.requiresSignature &&
        (delivery.signedAt ? (
          <p className="rounded-md bg-surface-muted p-3 text-sm">
            Firmado el {formatLongDate(isoDate(delivery.signedAt))} por {delivery.signedBy?.name}.{' '}
            {delivery.certificateFile && canDownload && (
              <a href={`/api/files/${delivery.certificateFile.id}`} className="underline">
                Descargar certificado de conformidad
              </a>
            )}
          </p>
        ) : (
          ready && canDownload && <SignForm id={delivery.id} />
        ))}
    </div>
  );
}
