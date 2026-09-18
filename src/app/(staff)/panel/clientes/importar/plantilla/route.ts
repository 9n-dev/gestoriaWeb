import { AppError } from '@/lib/errors';
import { can } from '@/modules/auth/permissions';
import { getSessionUser } from '@/modules/auth/session';
import { clientImportTemplate } from '@/modules/clients/import';

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, 'client.import')) {
    return new Response(null, { status: new AppError('FORBIDDEN', '').status });
  }
  return new Response(clientImportTemplate(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="plantilla-clientes.csv"',
    },
  });
}
