import { cn, priorityClasses, priorityLabel } from '@/lib/utils';
import type { Priority } from '@/lib/types';

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
  showLabel?: boolean;
}

// Inline styles avoid Tailwind JIT purging dynamically constructed class names
const DOT_COLORS: Record<number, string> = {
  0: '#6b7280',
  1: '#ef4444',
  2: '#f97316',
  3: '#3b82f6',
  4: '#6b7280',
};

export function PriorityBadge({
  priority,
  className,
  showLabel = true,
}: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium',
        priorityClasses(priority),
        className
      )}
    >
      <span
        className="h-2 w-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: DOT_COLORS[priority] ?? DOT_COLORS[0] }}
      />
      {showLabel && priorityLabel(priority)}
    </span>
  );
}
