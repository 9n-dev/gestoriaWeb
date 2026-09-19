import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { getCurrentTenant } from '@/modules/tenants/current';
import { readableForeground } from '@/modules/branding/contrast';
import { parseBranding } from '@/modules/tenants/schema';
import { env } from '@/env';
import { RegisterServiceWorker } from '@/components/pwa/register';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  return {
    title: tenant ? `${tenant.name} · Portal de clientes` : 'Portal de clientes',
    description: 'Portal de clientes de tu gestoría',
    icons: {
      // Without an uploaded favicon the generated icon does the job (and nobody asks for /favicon.ico).
      icon: parseBranding(tenant?.branding).faviconFileId
        ? '/api/branding/favicon'
        : '/api/branding/icon/192',
      apple: '/api/branding/icon/180',
    },
    appleWebApp: { capable: true, title: tenant?.name ?? 'Portal de clientes' },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getCurrentTenant();
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: parseBranding(tenant?.branding).primaryColor ?? '#1d4ed8',
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = parseBranding((await getCurrentTenant())?.branding);
  // Button text follows the brand colour so it stays legible whatever the tenant picks.
  const colors = {
    ...(branding.primaryColor
      ? {
          '--color-primary': branding.primaryColor,
          '--color-primary-fg': readableForeground(branding.primaryColor),
        }
      : {}),
    ...(branding.accentColor ? { '--color-accent': branding.accentColor } : {}),
  } as CSSProperties;

  return (
    <html lang="es" style={colors}>
      <body className="min-h-dvh antialiased">
        {env.DEMO_MODE && (
          <p
            role="note"
            className="bg-amber-300 px-4 py-1.5 text-center text-sm font-medium text-black"
          >
            Entorno de demostración: los datos se reinician cada noche.
          </p>
        )}
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
