import { tenantDb } from '@/lib/db';
import { reportError } from '@/lib/report-error';
import { getObjectBytes } from '@/lib/storage/objects';
import { parseBranding } from '@/modules/tenants/schema';

/**
 * The tenant's logo for the documents we generate (invoices, signature certificates), only if
 * the antivirus has cleared it. A document is never held back by its decoration: any problem here
 * means a header without logo.
 */
export async function loadPdfLogo(tenantId: string, branding: unknown): Promise<Uint8Array | null> {
  const { logoFileId } = parseBranding(branding);
  if (!logoFileId) return null;
  try {
    const file = await tenantDb(tenantId).storedFile.findFirst({
      where: { id: logoFileId, kind: 'BRANDING', status: 'CLEAN', deletedAt: null },
    });
    return file ? await getObjectBytes(file.storageKey) : null;
  } catch (error) {
    reportError(error, { where: 'pdf-logo', tags: { tenantId } });
    return null;
  }
}
