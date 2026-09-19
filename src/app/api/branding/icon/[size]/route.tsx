import { ImageResponse } from 'next/og';
import { readableForeground } from '@/modules/branding/contrast';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';

const SIZES = new Set(['180', '192', '512']);

/**
 * Home-screen icon: the tenant's initial on its brand colour, full bleed so it survives any mask.
 * Drawn rather than derived from the logo: logos are rarely square and an icon must always exist.
 */
export async function GET(_: Request, context: { params: Promise<{ size: string }> }) {
  const { size } = await context.params;
  if (!SIZES.has(size)) return new Response(null, { status: 404 });
  const side = Number(size);
  const tenant = await getCurrentTenant();
  const background = parseBranding(tenant?.branding).primaryColor ?? '#1d4ed8';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        color: readableForeground(background),
        fontSize: side * 0.5,
        fontWeight: 700,
      }}
    >
      {(tenant?.name ?? 'P').trim().charAt(0).toUpperCase()}
    </div>,
    { width: side, height: side, headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
