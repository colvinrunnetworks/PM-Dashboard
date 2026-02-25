import { cn, progressColor } from '@/lib/utils';

interface ProgressBarProps {
  progress: number; // 0.0 – 1.0
  showLabel?: boolean;
  className?: string;
  height?: 'sm' | 'md' | 'lg';
}

const HEIGHT_CLASSES = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
};

export function ProgressBar({
  progress,
  showLabel = true,
  className,
  height = 'md',
}: ProgressBarProps) {
  const pct = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn('flex-1 rounded-full bg-slate-700/60', HEIGHT_CLASSES[height])}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', progressColor(progress))}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-9 text-right text-xs text-slate-400 tabular-nums">
          {pct}%
        </span>
      )}
    </div>
  );
}
