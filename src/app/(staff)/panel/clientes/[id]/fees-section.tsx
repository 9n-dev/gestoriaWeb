'use client';

import { saveFeeAction, setFeeActiveAction } from '@/app/actions/billing';
import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton } from '@/components/ui/form';

type Fee = {
  id: string;
  concept: string;
  amount: string;
  vatRate: string;
  irpfRate: string;
  active: boolean;
};

export function FeesSection({
  clientId,
  fees,
  today,
}: {
  clientId: string;
  fees: Fee[];
  today: string;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {fees.length > 0 && (
        <ul className="flex flex-col">
          {fees.map((fee) => (
            <li
              key={fee.id}
              className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1.5"
            >
              <span className={fee.active ? '' : 'text-fg-muted line-through'}>
                {fee.concept} · {fee.amount} € + {fee.vatRate} % IVA
                {fee.irpfRate !== '0' && ` − ${fee.irpfRate} % IRPF`} al mes
              </span>
              <ActionForm action={setFeeActiveAction.bind(null, clientId, fee.id, !fee.active)}>
                <SubmitButton variant="ghost" pendingLabel="…">
                  {fee.active ? 'Pausar' : 'Reactivar'}
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <ActionForm
        action={saveFeeAction.bind(null, clientId)}
        className="grid max-w-3xl items-end gap-3 sm:grid-cols-[1fr_8rem_6rem_6rem_10rem_auto]"
      >
        <Field label="Concepto" name="concept" id="fee-concept" required />
        <Field label="Importe (€)" name="amount" id="fee-amount" inputMode="decimal" required />
        <Field label="% IVA" name="vatRate" id="fee-vat" defaultValue="21" />
        <Field label="% IRPF" name="irpfRate" id="fee-irpf" defaultValue="0" />
        <Field
          label="Desde"
          name="startsOn"
          id="fee-start"
          type="date"
          defaultValue={today}
          required
        />
        <SubmitButton variant="secondary">Añadir cuota</SubmitButton>
      </ActionForm>
    </div>
  );
}
