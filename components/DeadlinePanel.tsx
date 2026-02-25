'use client';

import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { ProgressBar } from './ProgressBar';
import type { DeadlineItem } from '@/lib/types';

interface DeadlinePanelProps {
  deadlines: DeadlineItem[];
  className?: string;
}

function urgencyClasses(daysUntil: number): string {
  if (daysUntil <= 3)  return 'text-red-400 font-semibold';
  if (daysUntil <= 7)  return 'text-orange-400 font-medium';
  if (daysUntil <= 14) return 'text-yellow-400';
  return 'text-slate-400';
}

function urgencyLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Due today';
  if (daysUntil === 1) return 'Due tomorrow';
  return `${daysUntil}d`;
}

export function DeadlinePanel({ deadlines, className }: DeadlinePanelProps) {
  return (
    <div className={cn('rounded-lg border border-slate-700/50 bg-slate-800/40', className)}>
      <div className="flex items-center gap-2 border-b border-slate-700/50 px-4 py-3">
        <CalendarClock className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">Upcoming Deadlines</h2>
        <span className="ml-auto rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
          Next 30 days
        </span>
      </div>

      {deadlines.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          No deadlines in the next 30 days.
        </div>
      ) : (
        <ul className="divide-y divide-slate-700/40">
          {deadlines.map((item) => (
            <li key={item.projectId}>
              <Link
                href={`/programs/${item.teamId}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-700/30"
              >
                <span
                  className="h-8 w-0.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.teamColor }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">
                      {item.projectName}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{item.teamName}</span>
                  </div>
                  <ProgressBar progress={item.progress} height="sm" className="mt-1.5 max-w-xs" />
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn('text-sm', urgencyClasses(item.daysUntil))}>
                    {urgencyLabel(item.daysUntil)}
                  </div>
                  <div className="text-xs text-slate-500">{formatDate(item.targetDate)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
