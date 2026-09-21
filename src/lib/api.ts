import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { reportError } from '@/lib/report-error';
import { AppError, toUserMessage } from '@/lib/errors';
import type { AuthenticatedUser } from '@/modules/auth/service';
import { getSessionUser, mustAcceptAgreements } from '@/modules/auth/session';

/**
 * Thin JSON route handler: authenticated user in, service result out. AppErrors keep their status
 * and Spanish message; anything else is logged and collapses to a generic 500.
 */
export function apiRoute<Context>(
  handler: (user: AuthenticatedUser, request: Request, context: Context) => Promise<unknown>,
) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      const user = await getSessionUser();
      if (!user)
        return NextResponse.json(
          { error: 'Tu sesión ha caducado. Vuelve a entrar.' },
          { status: 401 },
        );
      if (await mustAcceptAgreements(user)) {
        return NextResponse.json(
          {
            error: 'Antes de continuar, acepta el contrato de encargo de tratamiento en el portal.',
          },
          { status: 403 },
        );
      }
      const result = await handler(user, request, context);
      return result instanceof Response ? result : NextResponse.json(result ?? {});
    } catch (error) {
      if (error instanceof AppError)
        return NextResponse.json({ error: error.userMessage }, { status: error.status });
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: error.issues[0]?.message ?? 'Datos no válidos.' },
          { status: 422 },
        );
      }
      reportError(error, { where: 'api' });
      return NextResponse.json({ error: toUserMessage(error) }, { status: 500 });
    }
  };
}
