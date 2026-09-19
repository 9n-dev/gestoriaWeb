import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getPendingUser, homePathFor } from '@/modules/auth/session';
import { startEnrolment } from '@/modules/auth/two-factor/service';
import { logoutAction } from '../actions';
import { ChallengeForm, EnrolmentForm } from './forms';

export const metadata = { title: 'Verificación en dos pasos' };

/**
 * Second step of the login. Three cases: the challenge (2FA already on), the mandatory enrolment
 * (staff without it) and the voluntary one (a client coming from "Tu cuenta" with ?activar=1).
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ activar?: string }>;
}) {
  const user = (await getPendingUser()) ?? redirect('/acceso');
  const voluntary = user.twoFactor === 'ok' && !user.totpEnabled && (await searchParams).activar;
  if (user.twoFactor === 'ok' && !voluntary) redirect(homePathFor(user));

  if (user.twoFactor === 'challenge') {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
          <p className="mt-1 text-fg-muted">
            Introduce el código de tu aplicación de autenticación.
          </p>
        </div>
        <ChallengeForm />
        <form action={logoutAction}>
          <button type="submit" className="text-sm underline">
            Salir y entrar con otra cuenta
          </button>
        </form>
      </div>
    );
  }

  const { secret, uri } = await startEnrolment(user);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Activa la verificación en dos pasos</h1>
        <p className="mt-1 text-fg-muted">
          {voluntary
            ? 'Añade una segunda comprobación al entrar en tu cuenta.'
            : 'Es obligatoria para el equipo de la gestoría: protege los datos de vuestros clientes.'}
        </p>
      </div>
      <ol className="flex list-decimal flex-col gap-4 pl-5">
        <li>Instala una aplicación de autenticación (Google Authenticator, Aegis, 1Password…).</li>
        <li>
          Escanea este código con ella:
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
          <img
            src={qr}
            alt="Código QR para la aplicación de autenticación"
            width={220}
            height={220}
            className="mt-2 rounded-md bg-white p-2"
          />
          <span className="mt-2 block text-sm text-fg-muted">
            ¿No puedes escanearlo? Escribe esta clave: <code className="break-all">{secret}</code>
          </span>
        </li>
        <li>Escribe el código que te muestra.</li>
      </ol>
      <EnrolmentForm />
    </div>
  );
}
