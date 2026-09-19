'use client';

import { useState } from 'react';
import { updatePrefsAction } from '@/app/actions/notifications';
import { Button } from '@/components/ui/button';
import { ActionForm, SubmitButton } from '@/components/ui/form';

const MUTABLE = [
  ['NEW_MESSAGE', 'Mensajes nuevos'],
  ['DEADLINE_REMINDER', 'Recordatorios de plazos'],
  ['MISSING_DOCS_REMINDER', 'Recordatorios de documentación pendiente'],
  ['DELIVERY_AVAILABLE', 'Documentos nuevos de la gestoría'],
  ['OBLIGATION_FILED', 'Modelos presentados'],
] as const;

export function NotificationSettings({
  email,
  push,
  mutedTypes,
}: {
  email: boolean;
  push: boolean;
  mutedTypes: string[];
}) {
  return (
    <ActionForm action={updatePrefsAction} className="flex max-w-xl flex-col gap-4 text-sm">
      <p className="text-fg-muted">
        Las notificaciones siempre quedan en el portal. Elige además por dónde te avisamos:
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="email" defaultChecked={email} className="size-4" /> Por correo
        electrónico
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="push" defaultChecked={push} className="size-4" /> Con avisos en
        mis dispositivos
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">No me aviséis por correo ni en el móvil de:</legend>
        {MUTABLE.map(([type, label]) => (
          <label key={type} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="muted"
              value={type}
              defaultChecked={mutedTypes.includes(type)}
              className="size-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <SubmitButton>Guardar preferencias</SubmitButton>
    </ActionForm>
  );
}

const toKey = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

/** Subscribes this browser to web push. Asks for permission only when the person presses the button. */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<{ text: string; error?: boolean }>({ text: '' });

  const enable = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return setState({ text: 'Este navegador no admite avisos.', error: true });
      }
      if (!vapidPublicKey)
        return setState({
          text: 'Los avisos en el dispositivo no están configurados en este entorno.',
          error: true,
        });
      if ((await Notification.requestPermission()) !== 'granted') {
        return setState({
          text: 'Has bloqueado los avisos. Puedes permitirlos en los ajustes del navegador.',
          error: true,
        });
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toKey(vapidPublicKey),
      });
      const response = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState({ text: 'Avisos activados en este dispositivo.' });
    } catch {
      setState({ text: 'No hemos podido activar los avisos.', error: true });
    }
  };

  const disable = async () => {
    const registration = await navigator.serviceWorker?.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/push', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    setState({ text: 'Avisos desactivados en este dispositivo.' });
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={enable}>
          Activar avisos en este dispositivo
        </Button>
        <Button type="button" variant="ghost" onClick={disable}>
          Desactivar
        </Button>
      </div>
      <p aria-live="polite" className={state.error ? 'text-danger' : 'text-accent'}>
        {state.text}
      </p>
    </div>
  );
}
