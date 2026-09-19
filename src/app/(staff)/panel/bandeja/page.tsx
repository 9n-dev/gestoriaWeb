import { todayInMadrid } from '@/lib/dates';
import { periodValue, recentQuarters } from '@/lib/periods';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers } from '@/modules/clients/service';
import { listSavedViews } from '@/modules/documents/saved-views';
import { getRejectionReasons, inboxFiltersSchema, listInbox } from '@/modules/documents/service';
import { filtersFromParams } from './filters';
import { Inbox, type InboxDocument } from './inbox';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireArea('area.staff');
  const parsed = inboxFiltersSchema.safeParse(filtersFromParams(await searchParams));
  const filters = parsed.success ? parsed.data : inboxFiltersSchema.parse({});

  const [rows, views, reasons, managers] = await Promise.all([
    listInbox(user, filters),
    listSavedViews(user),
    getRejectionReasons(user.tenantId!),
    can(user, 'dashboard.viewGlobal') ? listAssignableManagers(user) : [],
  ]);

  // Plain objects only: Prisma decimals and dates do not cross to client components.
  const documents: InboxDocument[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    type: row.type,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    clientName: row.client.legalName,
    uploadedBy: row.uploadedBy?.name ?? null,
    fileId: row.file.id,
    fileName: row.file.originalName,
    mimeType: row.file.mimeType,
    fileStatus: row.file.status,
    period: row.period ? periodValue(row.period) : '',
    duplicateOfId: row.duplicateOfId,
    confirmed: row.extractionConfirmed,
    extraction: row.extractionStatus,
    confidence: row.confidence,
    rejectionReason: row.rejectionReason,
    fields: {
      supplierName: row.supplierName ?? '',
      supplierTaxId: row.supplierTaxId ?? '',
      invoiceNumber: row.invoiceNumber ?? '',
      invoiceDate: row.invoiceDate?.toISOString().slice(0, 10) ?? '',
      taxBase: row.taxBase?.toString().replace('.', ',') ?? '',
      vatRate: row.vatRate?.toString().replace('.', ',') ?? '',
      vatAmount: row.vatAmount?.toString().replace('.', ',') ?? '',
      total: row.total?.toString().replace('.', ',') ?? '',
    },
  }));

  return (
    <Inbox
      documents={documents}
      filters={filters}
      views={views}
      reasons={reasons}
      managers={managers}
      periods={recentQuarters(todayInMadrid(), 8)}
    />
  );
}
