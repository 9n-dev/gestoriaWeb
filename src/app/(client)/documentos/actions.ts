'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { deleteDocument } from '@/modules/documents/service';

export async function withdrawDocumentAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await deleteDocument(await requireUser(), id);
    revalidatePath('/documentos');
    return {};
  });
}
