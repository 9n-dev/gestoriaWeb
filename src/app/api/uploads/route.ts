import { apiRoute } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { initiateUpload } from '@/modules/documents/uploads';

export const POST = apiRoute(async (user, request) => {
  await rateLimit('upload', user.id);
  return initiateUpload(user, await request.json());
});
