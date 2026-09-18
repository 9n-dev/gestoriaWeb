import { tenantDb } from '@/lib/db';
import { getObjectBytes } from '@/lib/storage/objects';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';

/** Public by design: the logo is shown on the login page. Only BRANDING files are ever served here. */
export async function GET() {
  const tenant = await getCurrentTenant();
  const logoFileId = parseBranding(tenant?.branding).logoFileId;
  const file =
    tenant && logoFileId
      ? await tenantDb(tenant.id).storedFile.findFirst({
          where: { id: logoFileId, kind: 'BRANDING', deletedAt: null },
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
