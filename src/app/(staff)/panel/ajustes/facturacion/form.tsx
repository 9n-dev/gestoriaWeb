'use client';

import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton } from '@/components/ui/form';
import type { BillingSettings } from '@/modules/billing/schema';
import { saveBillingSettingsAction } from './actions';

const hint = 'text-sm text-fg-muted';

export function BillingSettingsForm({ settings }: { settings: BillingSettings }) {
  return (
    <ActionForm action={saveBillingSettingsAction} className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Field
          label="Plazo de pago (días)"
          name="paymentDays"
          type="number"
          min={0}
          max={120}
          defaultValue={settings.paymentDays}
          aria-describedby="paymentDays-hint"
          required
        />
        <p id="paymentDays-hint" className={hint}>
          Días desde la emisión hasta el vencimiento de las facturas mensuales.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Field
          label="Recordatorios de impago (días tras el vencimiento)"
          name="dunningDays"
          inputMode="numeric"
          defaultValue={settings.dunningDays.join(', ')}
          aria-describedby="dunningDays-hint"
        />
        <p id="dunningDays-hint" className={hint}>
          Separados por comas, hasta 6. Déjalo vacío para no enviar recordatorios.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Field
          label="Pasar el cliente a moroso a los (días)"
          name="delinquentAfterDays"
          type="number"
          min={1}
          max={365}
          defaultValue={settings.delinquentAfterDays}
          aria-describedby="delinquent-hint"
          required
        />
        <p id="delinquent-hint" className={hint}>
          Un cliente moroso puede seguir subiendo documentos y pagando, pero no descargar entregas.
          Vuelve a activo solo cuando no le queda nada vencido.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Field
          label="Serie de facturación"
          name="seriesCode"
          maxLength={10}
          defaultValue={settings.seriesCode}
          aria-describedby="series-hint"
          className="uppercase"
          required
        />
        <p id="series-hint" className={hint}>
          Las facturas se numeran como {settings.seriesCode}-2026-00001. Si cambias la serie, la
          nueva empieza su propia numeración desde 1; las facturas ya emitidas no cambian. La serie
          R se reserva para las rectificativas.
        </p>
      </div>
      <SubmitButton>Guardar</SubmitButton>
    </ActionForm>
  );
}
