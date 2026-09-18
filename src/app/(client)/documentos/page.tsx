import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import { periodLabel } from '@/lib/labels';
import { DOCUMENT_STATUS, fileStatusNote } from '@/lib/labels-documents';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import { listClientsFor } from '@/modules/clients/service';
import { listClientDocuments } from '@/modules/documents/service';
import { WithdrawButton } from './withdraw-button';

export default async function ClientDocumentsPage() {
  const user = await requireArea('area.client');
  const clients = await listClientsFor(user);
  const documents = (
    await Promise.all(clients.map((client) => listClientDocuments(user, client.id)))
  )
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mis documentos</h1>
        <Link
          href="/subir"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          Subir más
        </Link>
      </div>
      {documents.length === 0 ? (
        <p className="text-fg-muted">Todavía no has enviado ningún documento.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((document) => {
            const resource = {
              tenantId: document.tenantId,
              clientId: document.clientId,
              documentStatus: document.status,
              clientStatus: document.client.status,
              fileStatus: document.file.status,
            };
            return (
              <li key={document.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">
                    {can(user, 'document.download', resource) ? (
                      <a
                        href={`/api/files/${document.file.id}?inline`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {document.file.originalName}
                      </a>
                    ) : (
                      document.file.originalName
                    )}
                  </span>
                  <span className={document.status === 'REJECTED' ? 'font-medium text-danger' : ''}>
                    {fileStatusNote(document.file.status) ?? DOCUMENT_STATUS[document.status]}
                  </span>
                </div>
                <p className="text-fg-muted">
                  {DOCUMENT_TYPE_LABELS[document.type]}
                  {document.period && ` · ${periodLabel(document.period)}`} ·{' '}
                  {formatLongDate(document.createdAt.toISOString().slice(0, 10))}
                  {clients.length > 1 && ` · ${document.client.legalName}`}
                </p>
                {document.status === 'REJECTED' && (
                  <p className="mt-1">
                    <strong>{document.rejectionReason}</strong>
                    {document.rejectionNote && `. ${document.rejectionNote}`}
                  </p>
                )}
                {can(user, 'document.delete', resource) && <WithdrawButton id={document.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
