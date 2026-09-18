import { z } from 'zod';
import { apiRoute } from '@/lib/api';
import { signPart } from '@/modules/documents/uploads';

type Context = { params: Promise<{ fileId: string }> };
const bodySchema = z.object({ partNumber: z.number().int().positive() });

export const POST = apiRoute<Context>(async (user, request, { params }) => {
  const { partNumber } = bodySchema.parse(await request.json());
  return { url: await signPart(user, (await params).fileId, partNumber) };
});
