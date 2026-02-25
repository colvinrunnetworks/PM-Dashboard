import Link from 'next/link';
import { Activity, AlertTriangle, CheckCircle2, Clock, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PortfolioStats } from '@/lib/types';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  bg: string;
  href?: string;
}

function StatCard({ label, value, icon, accent, bg, href }: StatCardProps) {
  const inner = (
    <div className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-3 h-full">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-md', bg)}>
        {icon}
      </div>
      <div>
        <div className={cn('text-2xl font-bold tabular-nums leading-none', accent)}>
          {value}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition-opacity hover:opacity-80">
        {inner}
      </Link>
    );
  }

  return inner;
}

interface StatsRowProps {
  stats: PortfolioStats;
  className?: string;
}

export function StatsRow({ stats, className }: StatsRowProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}>
      <StatCard
        label="Active Programs"
        value={stats.active}
        icon={<Activity className="h-4 w-4 text-blue-400" />}
        accent="text-blue-400"
        bg="bg-blue-900/40"
      />
      <StatCard
        label="On Track"
        value={stats.onTrack}
        icon={<TrendingUp className="h-4 w-4 text-green-400" />}
        accent="text-green-400"
        bg="bg-green-900/40"
      />
      <StatCard
        label="At Risk"
        value={stats.atRisk}
        icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
        accent="text-orange-400"
        bg="bg-orange-900/40"
        href={stats.atRisk > 0 ? '/attention' : undefined}
      />
      <StatCard
        label="Overdue"
        value={stats.overdue}
        icon={<Clock className="h-4 w-4 text-red-400" />}
        accent="text-red-400"
        bg="bg-red-900/40"
        href={stats.overdue > 0 ? '/attention' : undefined}
      />
      <StatCard
        label="Completed"
        value={stats.completed}
        icon={<CheckCircle2 className="h-4 w-4 text-slate-400" />}
        accent="text-slate-300"
        bg="bg-slate-700/40"
      />
    </div>
  );
}
