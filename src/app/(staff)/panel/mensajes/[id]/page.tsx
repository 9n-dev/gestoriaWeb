import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Composer } from '@/components/messaging/composer';
import { Conversation } from '@/components/messaging/conversation';
import { THREAD_TYPE } from '@/components/messaging/thread-list';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers } from '@/modules/clients/service';
import { getThread, threadResource } from '@/modules/messaging/service';
import { listMessageTemplates } from '@/modules/messaging/templates';
import { ThreadStatusButton } from './thread-status';

export default async function StaffThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.staff');
  const { thread, messages } = await getThread(user, (await params).id).catch(() => notFound());
  const internal = thread.type === 'INTERNAL';
  const [templates, colleagues] = await Promise.all([
    internal ? [] : listMessageTemplates(user),
    internal ? listAssignableManagers(user) : [],
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-fg-muted">
            <Link href="/panel/mensajes" className="underline">
              Mensajes
            </Link>{' '}
            ·{' '}
            <Link href={`/panel/clientes/${thread.clientId}`} className="underline">
              {thread.client.legalName}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{thread.subject}</h1>
          <p className="text-sm text-fg-muted">
            {THREAD_TYPE[thread.type]}
            {internal && ' · el cliente no ve esta conversación'}
            {thread.status === 'CLOSED' && ' · cerrada'}
          </p>
        </div>
        {can(user, 'thread.close', threadResource(thread)) && (
          <ThreadStatusButton threadId={thread.id} closed={thread.status === 'CLOSED'} />
        )}
      </div>
      <Conversation messages={messages} viewerId={user.id} />
      <Composer
        threadId={thread.id}
        clientId={thread.clientId}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        colleagues={colleagues.filter((person) => person.id !== user.id)}
      />
    </div>
  );
}
