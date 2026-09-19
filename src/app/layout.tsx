import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { getCurrentTenant } from '@/modules/tenants/current';
import { readableForeground } from '@/modules/branding/contrast';
import { parseBranding } from '@/modules/tenants/schema';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  return {
    title: tenant ? `${tenant.name} · Portal de clientes` : 'Portal de clientes',
    description: 'Portal de clientes de tu gestoría',
    icons: parseBranding(tenant?.branding).faviconFileId
      ? { icon: '/api/branding/favicon' }
      : undefined,
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

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
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
