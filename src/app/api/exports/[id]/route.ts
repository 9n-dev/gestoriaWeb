import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api';
import { exportUrlForUser } from '@/modules/gdpr/export';

/** Panel door to a data export: permission check, audit entry, then a 5-minute signed URL. */
export const GET = apiRoute<{ params: Promise<{ id: string }> }>(async (user, _request, context) =>
  NextResponse.redirect(await exportUrlForUser(user, (await context.params).id)),
);
