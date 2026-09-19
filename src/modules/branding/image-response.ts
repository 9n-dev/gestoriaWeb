import { tenantDb } from '@/lib/db';
import { getObjectBytes } from '@/lib/storage/objects';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';

/** Public by design: shown on the login page and in the browser tab. Only BRANDING files are served. */
export async function brandingImageResponse(
  which: 'logoFileId' | 'faviconFileId',
): Promise<Response> {
  const tenant = await getCurrentTenant();
  const fileId = parseBranding(tenant?.branding)[which];
  const file =
    tenant && fileId
      ? await tenantDb(tenant.id).storedFile.findFirst({
          where: { id: fileId, kind: 'BRANDING', deletedAt: null, status: { not: 'INFECTED' } },
        })
      : null;
  if (!file) return new Response(null, { status: 404 });

  return new Response(Buffer.from(await getObjectBytes(file.storageKey)), {
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
