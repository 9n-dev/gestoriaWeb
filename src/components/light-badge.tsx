import type { Light } from '@/modules/checklists/light';

const STYLES: Record<Light, { dot: string; label: string }> = {
  GREEN: { dot: 'bg-green-600', label: 'Verde' },
  AMBER: { dot: 'bg-amber-500', label: 'Ámbar' },
  RED: { dot: 'bg-red-600', label: 'Rojo' },
};

/** Traffic light. Always colour plus text: colour alone is not accessible. */
export function LightBadge({ light, text }: { light: Light; text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-2.5 rounded-full ${STYLES[light].dot}`} />
      {text ?? STYLES[light].label}
    </span>
  );
}
