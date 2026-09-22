'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { queueAll, queueRemove } from './offline-queue';
import { sendPending } from './queued-upload';
import { UploadError } from './upload-client';

/**
 * Drains staff uploads (receipts, deliveries, permanent documents, attachments) that were left in
 * IndexedDB by a lost connection or a closed tab. Client documents are the uploader's own business.
 * Rendered in the header, so it works on every page.
 */
export function PendingUploads() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let running = false;
    const drain = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        const entries = (await queueAll()).filter((entry) => entry.meta.purpose !== 'DOCUMENT');
        if (entries.length === 0) return;
        setStatus(
          `Enviando ${entries.length} ${entries.length === 1 ? 'archivo pendiente' : 'archivos pendientes'} de una conexión anterior…`,
        );
        let sent = 0;
        for (const entry of entries) {
          try {
            await sendPending(entry);
            await queueRemove(entry.id);
            sent++;
          } catch (error) {
            // Refused for good (validation, permission): drop it. A network error waits for the next try.
            if (error instanceof UploadError && error.permanent) await queueRemove(entry.id);
          }
        }
        setStatus(
          sent
            ? `${sent} ${sent === 1 ? 'archivo pendiente enviado' : 'archivos pendientes enviados'}.`
            : null,
        );
        if (sent) router.refresh();
      } catch {
        setStatus(null);
      } finally {
        running = false;
      }
    };
    void drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
  }, [router]);

  return status ? (
    <p role="status" className="bg-surface-muted px-4 py-1.5 text-center text-sm">
      {status}
    </p>
  ) : null;
}
