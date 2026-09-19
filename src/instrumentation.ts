import type { Instrumentation } from 'next';

/** Next calls this for every uncaught server error: pages, layouts, route handlers, actions. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // eslint-disable-next-line no-restricted-properties -- set by Next itself, not configuration
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('@/lib/report-error');
  reportError(error, {
    where: 'request',
    tags: { path: request.path, method: request.method, route: context.routePath },
  });
};
