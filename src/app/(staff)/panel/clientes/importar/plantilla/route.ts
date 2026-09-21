import { parseCsv } from '@/lib/csv';
import { AppError } from '@/lib/errors';
import { xlsx } from '@/lib/xlsx';
import { can } from '@/modules/auth/permissions';
import { getSessionUser, mustAcceptAgreements } from '@/modules/auth/session';
import { clientImportTemplate } from '@/modules/clients/import';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || (await mustAcceptAgreements(user)) || !can(user, 'client.import')) {
    return new Response(null, { status: new AppError('FORBIDDEN', '').status });
  }
  if (new URL(request.url).searchParams.get('formato') === 'xlsx') {
    return new Response(Buffer.from(xlsx('Clientes', parseCsv(clientImportTemplate()))), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="plantilla-clientes.xlsx"',
      },
    });
  }
  return new Response(clientImportTemplate(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="plantilla-clientes.csv"',
    },
  });
}
