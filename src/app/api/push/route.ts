import { z } from 'zod';
import { apiRoute } from '@/lib/api';
import { subscribePush, unsubscribePush } from '@/modules/messaging/notifications';

export const POST = apiRoute(async (user, request) => {
  await subscribePush(user, {
    ...(await request.json()),
    userAgent: request.headers.get('user-agent') ?? undefined,
  });
});

export const DELETE = apiRoute(async (user, request) => {
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await request.json());
  await unsubscribePush(user, endpoint);
});
