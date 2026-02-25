import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CUIBadgeProps {
  className?: string;
  compact?: boolean;
}

export function CUIBadge({ className, compact = false }: CUIBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider',
        'border border-orange-600 bg-orange-950/50 text-orange-400',
        className
      )}
      title="Controlled Unclassified Information"
    >
      <ShieldAlert className="h-3 w-3" />
      {!compact && 'CUI'}
    </span>
  );
}
