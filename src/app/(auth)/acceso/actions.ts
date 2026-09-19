'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { LoginError, signIn, signOut } from '@/auth';
import {
  magicLinkRequestSchema,
  magicLinkTokenSchema,
  passwordLoginSchema,
} from '@/modules/auth/schema';
import { requestMagicLink } from '@/modules/auth/service';
import { getCurrentTenant } from '@/modules/tenants/current';
import { requestHost } from '@/modules/tenants/resolve';

export type LoginState = { error?: string; info?: string };

/** Runs an Auth.js sign-in and turns its failures into a message for the form. */
async function attempt(provider: 'password' | 'magic-link', data: Record<string, string>) {
  try {
    await signIn(provider, { ...data, redirect: false });
  } catch (error) {
    if (error instanceof LoginError) return { error: error.userMessage };
    if (error instanceof AuthError) return { error: 'No hemos podido iniciar la sesión.' };
    throw error;
  }
  return null;
}

export async function passwordLoginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const input = passwordLoginSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message };

  const failure = await attempt('password', input.data);
  if (failure) return failure;
  redirect('/');
}

export async function magicLinkRequestAction(
  _: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const input = magicLinkRequestSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message };

  const h = await headers();
  const host = requestHost(h);
  const protocol = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  await requestMagicLink(await getCurrentTenant(), input.data.email, `${protocol}://${host}`);

  // Same answer whether or not the account exists.
  return { info: 'Si el correo está registrado, te hemos enviado un enlace de acceso.' };
}

export async function magicLinkLoginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const input = magicLinkTokenSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'El enlace no es válido o ha caducado. Solicita uno nuevo.' };

  const failure = await attempt('magic-link', input.data);
  if (failure) return failure;
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/acceso' });
}
