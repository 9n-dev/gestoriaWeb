import { formatLongDate, isoDate } from '@/lib/dates';
import { INVOICE_STATUS } from '@/lib/labels-billing';
import { formatEuros } from '@/lib/money';
import { requireArea } from '@/modules/auth/area';
import { listInvoices } from '@/modules/billing/service';
import { PayButtons } from './pay-buttons';

export default async function ClientInvoicesPage() {
  const invoices = await listInvoices(await requireArea('area.client'));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Facturas de la gestoría</h1>
      {invoices.length === 0 ? (
        <p className="text-fg-muted">No tienes facturas.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invoices.map((invoice) => {
            const payable = invoice.status === 'ISSUED' || invoice.status === 'OVERDUE';
            return (
              <li key={invoice.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <a href={`/api/files/${invoice.pdfFile?.id}`} className="font-medium underline">
                    Factura {invoice.fullNumber}
                  </a>
                  <span className="font-medium">{formatEuros(invoice.total)}</span>
                </div>
                <p
                  className={
                    invoice.status === 'OVERDUE' ? 'font-medium text-danger' : 'text-fg-muted'
                  }
                >
                  {INVOICE_STATUS[invoice.status]} ·{' '}
                  {invoice.issueDate && formatLongDate(isoDate(invoice.issueDate))}
                  {payable &&
                    invoice.dueDate &&
                    ` · vence el ${formatLongDate(isoDate(invoice.dueDate))}`}
                </p>
                {payable && <PayButtons id={invoice.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
