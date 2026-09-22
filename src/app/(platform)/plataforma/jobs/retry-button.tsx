'use client';

import { ActionForm, SubmitButton } from '@/components/ui/form';
import { retryAllJobsAction, retryJobAction } from './actions';

export function RetryButton({ queue, jobId }: { queue: string; jobId: string }) {
  return (
    <ActionForm
      action={retryJobAction.bind(null, queue, jobId)}
      className="flex items-center gap-2"
    >
      <SubmitButton variant="ghost" pendingLabel="…">
        Reintentar
      </SubmitButton>
    </ActionForm>
  );
}

export function RetryAllButton({ total }: { total: number }) {
  return (
    <ActionForm action={retryAllJobsAction} className="flex items-center gap-2">
      <SubmitButton variant="secondary" pendingLabel="Reencolando…">
        Reintentar los {total} jobs
      </SubmitButton>
    </ActionForm>
  );
}
