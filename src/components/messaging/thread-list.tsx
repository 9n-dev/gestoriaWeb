import Link from 'next/link';
import type { listThreads } from '@/modules/messaging/service';

const THREAD_TYPE = {
  PERIOD: 'Periodo',
  REQUIREMENT: 'Requerimiento',
  GENERAL: 'General',
  INTERNAL: 'Interno',
} as const;
const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

export { THREAD_TYPE };

export function ThreadList({
  threads,
  basePath,
  showClient,
}: {
  threads: Awaited<ReturnType<typeof listThreads>>;
  basePath: string;
  showClient: boolean;
}) {
  if (threads.length === 0) return <p className="text-fg-muted">No hay conversaciones.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`${basePath}/${thread.id}`}
            className={`block rounded-md border border-border p-3 text-sm hover:bg-surface-muted ${thread.unread ? 'border-l-4 border-l-primary' : ''}`}
          >
            <span className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className={thread.unread ? 'font-semibold' : 'font-medium'}>
                {thread.subject}
                {thread.unread && <span className="sr-only"> (sin leer)</span>}
              </span>
              <span className="text-xs text-fg-muted">{dateTime.format(thread.lastMessageAt)}</span>
            </span>
            <span className="block text-xs text-fg-muted">
              {showClient && `${thread.client.legalName} · `}
              {THREAD_TYPE[thread.type]}
              {thread.status === 'CLOSED' && ' · Cerrada'}
            </span>
            {thread.lastMessage && (
              <span className="mt-1 block truncate text-fg-muted">
                {thread.lastMessage.authorName}: {thread.lastMessage.preview}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
