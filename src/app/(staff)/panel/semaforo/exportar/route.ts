import { periodValue } from '@/lib/periods';
import { getSessionUser, mustAcceptAgreements } from '@/modules/auth/session';
import { overviewCsv, tenantOverview } from '@/modules/checklists/service';
import { AppError } from '@/lib/errors';
import { overviewParams } from '../params';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || (await mustAcceptAgreements(user))) return new Response(null, { status: 401 });
  const { period, filters } = overviewParams(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const csv = overviewCsv(await tenantOverview(user, period, filters));
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="semaforo-${periodValue(period).toLowerCase()}.csv"`,
      },
    });
  } catch (error) {
    return new Response(null, { status: error instanceof AppError ? error.status : 500 });
  }
}
