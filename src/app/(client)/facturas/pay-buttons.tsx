'use client';

import { payInvoiceAction } from '@/app/actions/billing';
import { ActionForm, SubmitButton } from '@/components/ui/form';

export function PayButtons({ id }: { id: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <ActionForm action={payInvoiceAction.bind(null, id, 'CARD')}>
        <SubmitButton pendingLabel="Abriendo el pago…">Pagar con tarjeta</SubmitButton>
      </ActionForm>
      <ActionForm action={payInvoiceAction.bind(null, id, 'SEPA_DEBIT')}>
        <SubmitButton variant="secondary" pendingLabel="…">
          Cargar en mi cuenta (SEPA)
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
