import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api';
import { requestMeta } from '@/lib/request';
import { fileAccessUrl } from '@/modules/documents/service';

type Context = { params: Promise<{ id: string }> };

/** The only door to a file: can() → audit → redirect to a 5-minute signed URL. `?inline=1` previews. */
export const GET = apiRoute<Context>(async (user, request, { params }) => {
  const inline = new URL(request.url).searchParams.has('inline');
  const url = await fileAccessUrl(user, (await params).id, { inline, ...(await requestMeta()) });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
});
