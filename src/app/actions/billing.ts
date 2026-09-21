'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { startPayment } from '@/modules/billing/payments';
import {
  cancelInvoice,
  createInvoice,
  issueInvoice,
  markPaid,
  saveFee,
  setFeeActive,
} from '@/modules/billing/service';

const done = (success: string): ActionState => {
  revalidatePath('/panel/facturacion');
  return { success };
};

export async function createInvoiceAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const values = formValues(formData);
    // One value per line and field, in document order (the form repeats the same field names).
    const column = (name: string) => formData.getAll(name).map((value) => String(value).trim());
    const [descriptions, quantities, prices, vatRates, irpfRates] = [
      'description',
      'quantity',
      'unitPrice',
      'vatRate',
      'irpfRate',
    ].map(column);
    const lines = descriptions!.map((description, i) => ({
      description,
      quantity: quantities![i] || '1',
      unitPrice: prices![i] ?? '',
      vatRate: vatRates![i] || '21',
      irpfRate: irpfRates![i] || '0',
    }));
    const id = await createInvoice(await requireUser(), {
      clientId: values.clientId ?? '',
      lines,
      paymentMethod: (values.paymentMethod ?? 'BANK_TRANSFER') as 'CARD',
    });
    await issueInvoice(await requireUser(), id);
    return done('Factura emitida. Hemos avisado al cliente.');
  });
}

export const markPaidAction = async (id: string, _: ActionState): Promise<ActionState> =>
  runAction(async () => {
    await markPaid(await requireUser(), id, 'BANK_TRANSFER');
    return done('Marcada como cobrada.');
  });

export const cancelInvoiceAction = async (id: string, _: ActionState): Promise<ActionState> =>
  runAction(async () => {
    await cancelInvoice(await requireUser(), id);
    return done('Factura anulada con su rectificativa.');
  });

export async function saveFeeAction(
  clientId: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const {
      concept = '',
      amount = '',
      vatRate = '21',
      irpfRate = '0',
      startsOn = '',
    } = formValues(formData);
    await saveFee(await requireUser(), clientId, { concept, amount, vatRate, irpfRate, startsOn });
    revalidatePath(`/panel/clientes/${clientId}`);
    return { success: 'Cuota guardada. Se facturará el día 1 de cada mes.' };
  });
}

export const setFeeActiveAction = async (
  clientId: string,
  id: string,
  active: boolean,
  _: ActionState,
): Promise<ActionState> =>
  runAction(async () => {
    await setFeeActive(await requireUser(), id, active);
    revalidatePath(`/panel/clientes/${clientId}`);
    return {};
  });

export async function payInvoiceAction(
  id: string,
  method: 'CARD' | 'SEPA_DEBIT',
  _: ActionState,
): Promise<ActionState> {
  const result = await runAction(async () => {
    const payment = await startPayment(await requireUser(), id, method);
    revalidatePath('/facturas');
    return {
      data: payment.checkoutUrl,
      success: payment.simulated
        ? 'Pago simulado (entorno de pruebas). Factura pagada.'
        : 'Hemos iniciado el cobro.',
    };
  });
  if (!result.error && typeof result.data === 'string') redirect(result.data);
  return result;
}
