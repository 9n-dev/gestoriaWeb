'use client';

import { completeOnboardingAction } from '@/app/(staff)/panel/ajustes/actions';
import { ActionForm, SubmitButton } from '@/components/ui/form';

export function FinishForm({ label, variant }: { label: string; variant?: 'primary' | 'ghost' }) {
  return (
    <ActionForm action={completeOnboardingAction} className="flex">
      <SubmitButton variant={variant} pendingLabel="Un momento…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
