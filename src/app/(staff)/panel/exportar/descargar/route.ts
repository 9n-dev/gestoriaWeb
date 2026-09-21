import { AppError } from '@/lib/errors';
import { parsePeriodValue } from '@/lib/periods';
import { getSessionUser, mustAcceptAgreements } from '@/modules/auth/session';
import { exportDocuments } from '@/modules/documents/export';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || (await mustAcceptAgreements(user))) return new Response(null, { status: 401 });
  const params = new URL(request.url).searchParams;
  const period = parsePeriodValue(params.get('periodo') ?? '');
  if (!period) return new Response('Periodo no válido', { status: 422 });
  try {
    const file = await exportDocuments(user, {
      period,
      clientId: params.get('cliente') || undefined,
      format: params.get('formato') === 'xlsx' ? 'xlsx' : 'csv',
    });
    return new Response(typeof file.body === 'string' ? file.body : Buffer.from(file.body), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(null, { status: error instanceof AppError ? error.status : 500 });
  }
}
