import { apiRoute } from '@/lib/api';
import { initiateUpload } from '@/modules/documents/uploads';

export const POST = apiRoute(async (user, request) => initiateUpload(user, await request.json()));
