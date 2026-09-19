import { NewThreadForm } from '@/components/messaging/new-thread-form';
import { ThreadList } from '@/components/messaging/thread-list';
import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';
import { listThreads } from '@/modules/messaging/service';

export default async function ClientThreadsPage() {
  const user = await requireArea('area.client');
  const [threads, clients] = await Promise.all([listThreads(user), listClientsFor(user)]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mensajes</h1>
      <ThreadList threads={threads} basePath="/mensajes" showClient={clients.length > 1} />
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Escribir a la gestoría</h2>
        <NewThreadForm
          clients={clients.map((client) => ({ id: client.id, name: client.legalName }))}
        />
      </section>
    </div>
  );
}
