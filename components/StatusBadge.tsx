import { cn, statusClasses, statusLabel } from '@/lib/utils';
import type { ProjectState } from '@/lib/types';

interface StatusBadgeProps {
  state: ProjectState;
  overrideLabel?: string;
  className?: string;
}

export function StatusBadge({ state, overrideLabel, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        statusClasses(state),
        className
      )}
    >
      {overrideLabel ?? statusLabel(state)}
    </span>
  );
}
