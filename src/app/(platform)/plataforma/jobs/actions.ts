'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { retryFailedJob } from '@/modules/platform/jobs';

export async function retryJobAction(
  queue: string,
  jobId: string,
  _: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    await retryFailedJob(await requireUser(), queue, jobId);
    revalidatePath('/plataforma/jobs');
    return { success: 'Reencolado.' };
  });
}
