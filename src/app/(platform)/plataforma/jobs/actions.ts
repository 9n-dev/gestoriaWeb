'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { retryAllFailedJobs, retryFailedJob } from '@/modules/platform/jobs';

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

export async function retryAllJobsAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const retried = await retryAllFailedJobs(await requireUser());
    revalidatePath('/plataforma/jobs');
    return { success: `${retried} ${retried === 1 ? 'job reencolado' : 'jobs reencolados'}.` };
  });
}
