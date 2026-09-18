import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';

const SECTIONS = [
  { href: '/panel/ajustes/gestoria', label: 'Gestoría' },
  { href: '/panel/ajustes/marca', label: 'Marca' },
  { href: '/panel/ajustes/equipo', label: 'Equipo' },
  { href: '/panel/ajustes/perfiles-fiscales', label: 'Perfiles fiscales' },
  { href: '/panel/ajustes/documentos', label: 'Documentos' },
];

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  if (!can(await requireArea('area.staff'), 'tenantSettings.manage')) notFound();
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Ajustes" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-surface-muted"
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
