'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setThreadMutedAction, setThreadStatusAction } from '@/app/actions/messaging';

export function ThreadStatusButton({ threadId, closed }: { threadId: string; closed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface-muted disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          await setThreadStatusAction(threadId, closed ? 'OPEN' : 'CLOSED');
          router.refresh();
        })
      }
    >
      {closed ? 'Reabrir conversación' : 'Cerrar conversación'}
    </button>
  );
}

export function ThreadMuteButton({ threadId, muted }: { threadId: string; muted: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={muted}
      className="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface-muted disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          await setThreadMutedAction(threadId, !muted);
          router.refresh();
        })
      }
    >
      {muted ? 'Silenciada: volver a avisarme' : 'Silenciar avisos'}
    </button>
  );
}
