'use client';

import { RefreshCw } from 'lucide-react';
import { cn, formatTimestamp } from '@/lib/utils';

interface RefreshButtonProps {
  onRefresh: () => void;
  loading: boolean;
  lastRefreshed: Date | null;
  className?: string;
}

export function RefreshButton({
  onRefresh,
  loading,
  lastRefreshed,
  className,
}: RefreshButtonProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {lastRefreshed && (
        <span className="text-xs text-slate-500">
          Updated {formatTimestamp(lastRefreshed)}
        </span>
      )}
      <button
        onClick={onRefresh}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
          'border border-slate-700 bg-slate-800 text-slate-300',
          'transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
