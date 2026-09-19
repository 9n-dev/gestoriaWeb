import { notFound } from 'next/navigation';
import { formatLongDate, isoDate } from '@/lib/dates';
import { INVOICE_STATUS } from '@/lib/labels-billing';
import { formatEuros } from '@/lib/money';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listInvoices } from '@/modules/billing/service';
import { listClientsFor } from '@/modules/clients/service';
import { InvoiceButtons, NewInvoiceForm } from './billing-forms';

export default async function BillingPage() {
  const user = await requireArea('area.staff');
  if (!can(user, 'invoice.manage')) notFound();
  const [invoices, clients] = await Promise.all([listInvoices(user), listClientsFor(user)]);
  const pending = invoices
    .filter((i) => i.status === 'ISSUED' || i.status === 'OVERDUE')
    .reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Facturación</h1>
        <p className="text-sm text-fg-muted">
          Pendiente de cobro: <strong>{formatEuros(pending)}</strong>. Las cuotas mensuales se
          facturan solas el día 1 (se configuran en la ficha de cada cliente).
        </p>
        {invoices.length === 0 ? (
          <p className="text-fg-muted">Todavía no hay facturas.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Facturas emitidas a clientes</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Número
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Cliente
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Fecha
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Total
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Estado
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-border">
                  <td className="py-2 pr-4">
                    {invoice.pdfFile ? (
                      <a
                        href={`/api/files/${invoice.pdfFile.id}?inline`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {invoice.fullNumber}
                      </a>
                    ) : (
                      'Borrador'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {invoice.client?.legalName ?? '(cliente eliminado)'}
                  </td>
                  <td className="py-2 pr-4">
                    {invoice.issueDate ? formatLongDate(isoDate(invoice.issueDate)) : '—'}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatEuros(invoice.total)}</td>
                  <td
                    className={`py-2 pr-4 ${invoice.status === 'OVERDUE' ? 'font-medium text-danger' : ''}`}
                  >
                    {INVOICE_STATUS[invoice.status]}
                  </td>
                  <td className="py-2">
                    <InvoiceButtons id={invoice.id} status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Nueva factura</h2>
        <NewInvoiceForm
          clients={clients.map((client) => ({ id: client.id, name: client.legalName }))}
        />
      </section>
    </div>
  );
}
