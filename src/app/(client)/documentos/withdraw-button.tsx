'use client';

import { ActionForm, SubmitButton } from '@/components/ui/form';
import { withdrawDocumentAction } from './actions';

export function WithdrawButton({ id }: { id: string }) {
  return (
    <ActionForm action={withdrawDocumentAction.bind(null, id)} className="flex">
      <SubmitButton variant="ghost" pendingLabel="Retirando…">
        Retirar
      </SubmitButton>
    </ActionForm>
  );
}
