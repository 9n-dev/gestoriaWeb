import { apiRoute } from '@/lib/api';
import { abortUpload, uploadStatus } from '@/modules/documents/uploads';

type Context = { params: Promise<{ fileId: string }> };

/** Which parts the bucket already has: lets the browser resume after a connection drop. */
export const GET = apiRoute<Context>(async (user, _request, { params }) =>
  uploadStatus(user, (await params).fileId),
);

export const DELETE = apiRoute<Context>(async (user, _request, { params }) =>
  abortUpload(user, (await params).fileId),
);
