import { apiRoute } from '@/lib/api';
import { completeUpload } from '@/modules/documents/uploads';

type Context = { params: Promise<{ fileId: string }> };

export const POST = apiRoute<Context>(async (user, _request, { params }) =>
  completeUpload(user, (await params).fileId),
);
