import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Composer } from '@/components/messaging/composer';
import { Conversation } from '@/components/messaging/conversation';
import { requireArea } from '@/modules/auth/area';
import { getThread } from '@/modules/messaging/service';

export default async function ClientThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.client');
  const { thread, messages } = await getThread(user, (await params).id).catch(() => notFound());
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-fg-muted">
          <Link href="/mensajes" className="underline">
            Mensajes
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{thread.subject}</h1>
      </div>
      <Conversation messages={messages} viewerId={user.id} />
      <Composer threadId={thread.id} clientId={thread.clientId} />
    </div>
  );
}
