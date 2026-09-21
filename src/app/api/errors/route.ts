import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { rateLimitByIp } from '@/lib/rate-limit';
import { reportError } from '@/lib/report-error';

const schema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
});

/**
 * Errors that happen in the browser (TD-075). Open to anonymous visitors on purpose — the login page
 * can break too — so it is rate limited, size limited and only ever forwards text to the error tracker.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await rateLimitByIp('clientError');
    const body = schema.parse(JSON.parse((await request.text()).slice(0, 8000)));
    const error = new Error(body.message);
    error.name = 'BrowserError';
    error.stack = body.stack;
    reportError(error, { where: 'browser', tags: { path: body.path ?? '' } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(null, { status: error instanceof AppError ? error.status : 400 });
  }
}
