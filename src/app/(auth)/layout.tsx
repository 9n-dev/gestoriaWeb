import type { ReactNode } from 'react';
import { env } from '@/env';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {env.DEMO_MODE && (
        <p role="status" className="bg-accent px-4 py-2 text-center text-sm text-white">
          Entorno de demostración: los datos se reinician cada noche
        </p>
      )}
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
