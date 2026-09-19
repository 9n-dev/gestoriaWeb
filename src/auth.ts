import 'server-only';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { env } from '@/env';
import { AppError } from '@/lib/errors';
import { magicLinkTokenSchema, passwordLoginSchema } from '@/modules/auth/schema';
import {
  completeLogin,
  consumeMagicLink,
  revokeSession,
  verifyPasswordLogin,
  type LoginMethod,
} from '@/modules/auth/service';
import { requestHost, resolveTenant } from '@/modules/tenants/resolve';
import type { User as DbUser } from '@prisma/client';

/** Carries the Spanish, user-safe message of an AppError through Auth.js to the login form. */
export class LoginError extends CredentialsSignin {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.code = 'login_failed';
  }
}

const THIRTY_DAYS_S = 30 * 24 * 3600;

function requestContext(request: Request) {
  const host = requestHost(request.headers);
  return {
    host,
    meta: {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
    },
  };
}

/** Resolves the tenant from the host, runs one login method and opens the server-side session. */
async function login(
  request: Request,
  method: LoginMethod,
  verify: (
    tenantId: string | null,
    meta: ReturnType<typeof requestContext>['meta'],
  ) => Promise<DbUser>,
) {
  try {
    const { host, meta } = requestContext(request);
    const tenant = await resolveTenant(host);
    const user = await verify(tenant?.id ?? null, meta);
    const session = await completeLogin(user, method, meta);
    return { id: user.id, sessionId: session.id };
  } catch (error) {
    if (error instanceof AppError) throw new LoginError(error.userMessage);
    throw error;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,
  // Upper bound only: the real expiry (12 h staff, 30 d clients) lives in UserSession.
  session: { strategy: 'jwt', maxAge: THIRTY_DAYS_S },
  pages: { signIn: '/acceso' },
  providers: [
    Credentials({
      id: 'password',
      credentials: { email: {}, password: {} },
      authorize: (credentials, request) => {
        const input = passwordLoginSchema.safeParse(credentials);
        if (!input.success) throw new LoginError('Correo o contraseña incorrectos.');
        return login(request, 'password', (tenantId, meta) =>
          verifyPasswordLogin(tenantId, input.data.email, input.data.password, meta),
        );
      },
    }),
    Credentials({
      id: 'magic-link',
      credentials: { token: {} },
      authorize: (credentials, request) => {
        const input = magicLinkTokenSchema.safeParse(credentials);
        if (!input.success) throw new LoginError('El enlace no es válido o ha caducado.');
        return login(request, 'magic-link', (tenantId) =>
          consumeMagicLink(tenantId, input.data.token),
        );
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.sessionId) token.sessionId = user.sessionId;
      return token;
    },
    session({ session, token }) {
      session.sessionId = token.sessionId;
      return session;
    },
  },
  events: {
    async signOut(message) {
      if ('token' in message && message.token?.sessionId) {
        await revokeSession(message.token.sessionId);
      }
    },
  },
});
