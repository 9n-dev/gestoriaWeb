import type { MetadataRoute } from 'next';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';

/** One manifest per tenant (white label): its name, its colour, its icon on the home screen (§6.14). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getCurrentTenant();
  const name = tenant?.name ?? 'Portal de clientes';
  return {
    name,
    short_name: name.slice(0, 12),
    description: 'Portal de clientes de tu gestoría',
    lang: 'es',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: parseBranding(tenant?.branding).primaryColor ?? '#1d4ed8',
    icons: [192, 512].flatMap((size) =>
      (['any', 'maskable'] as const).map((purpose) => ({
        src: `/api/branding/icon/${size}`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose,
      })),
    ),
    // Long press on the icon → straight to the camera button: photo of an invoice in two touches.
    shortcuts: [{ name: 'Subir documentos', url: '/subir' }],
  };
}
