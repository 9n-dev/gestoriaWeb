import { redirect } from 'next/navigation';
import { homePathFor, requireUser } from '@/modules/auth/session';

export default async function RootPage() {
  redirect(homePathFor(await requireUser()));
}
