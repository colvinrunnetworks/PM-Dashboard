'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Flag,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import {
  computeStats,
  computeDeadlines,
  computeCombinedDeadlines,
  cn,
  formatDate,
  milestoneStatusClasses,
  milestoneStatusLabel,
} from '@/lib/utils';
import { StatsRow } from '@/components/StatsRow';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import { TeamCard } from '@/components/TeamCard';
import { RefreshButton } from '@/components/RefreshButton';
import { ProgressBar } from '@/components/ProgressBar';
import type { Team, PortfolioStats, DeadlineItem, CombinedDeadlineItem } from '@/lib/types';

// ── Urgency helpers ────────────────────────────────────────────────────────────

function urgencyBadgeClasses(days: number): string {
  if (days <= 0)  return 'bg-red-900/70 text-red-300 border border-red-700';
  if (days <= 3)  return 'bg-red-900/60 text-red-300 border border-red-700';
  if (days <= 7)  return 'bg-orange-900/60 text-orange-300 border border-orange-700';
  return 'bg-slate-800/60 text-slate-400 border border-slate-700';
}

function urgencyLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days}d`;
}

// ── Single deadline row ────────────────────────────────────────────────────────

function DeadlineRow({ item }: { item: CombinedDeadlineItem }) {
  const isMilestone = item.kind === 'milestone';
  return (
    <Link
      href={`/programs/${item.teamId}`}
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-700/25"
    >
      {/* Team color stripe */}
      <span
        className="h-8 w-0.5 rounded-full shrink-0"
        style={{ backgroundColor: item.teamColor }}
      />

      {/* Kind icon */}
      <div className="shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors">
        {isMilestone
          ? <Flag className="h-3.5 w-3.5" />
          : <Layers className="h-3.5 w-3.5" />
        }
      </div>

      {/* Label + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-200 truncate">
            {item.label}
          </span>
          {isMilestone && (
            <span className="text-xs text-slate-500 truncate">{item.projectName}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span
            className="font-mono rounded px-1 py-0.5 text-xs"
            style={{ color: item.teamColor, backgroundColor: `${item.teamColor}18` }}
          >
            {item.teamName}
          </span>
          {isMilestone && item.milestoneStatus && (
            <span className={cn('rounded px-1.5 py-0.5 text-xs', milestoneStatusClasses(item.milestoneStatus))}>
              {milestoneStatusLabel(item.milestoneStatus)}
            </span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="w-20 shrink-0 hidden sm:block">
        <ProgressBar progress={item.progress} height="sm" showLabel={false} />
        <div className="mt-0.5 text-right text-xs text-slate-600">
          {Math.round(item.progress * 100)}%
        </div>
      </div>

      {/* Urgency badge */}
      <div className={cn('shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums', urgencyBadgeClasses(item.daysUntil))}>
        {urgencyLabel(item.daysUntil)}
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-slate-700 group-hover:text-slate-400 shrink-0 transition-colors" />
    </Link>
  );
}

// ── Weekly deadlines section ───────────────────────────────────────────────────

function WeeklyDeadlinesSection({ items }: { items: CombinedDeadlineItem[] }) {
  const thisWeek = items.filter(i => i.daysUntil <= 7);
  const nextWeek = items.filter(i => i.daysUntil > 7 && i.daysUntil <= 14);

  if (thisWeek.length === 0 && nextWeek.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Deadlines — This Week &amp; Next
        </h2>
        <Link
          href="/deadlines"
          className="ml-auto text-xs text-slate-500 hover:text-blue-400 transition-colors"
        >
          View all →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* This Week */}
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-400">
              This Week
            </h3>
            <span className="rounded-full bg-orange-900/40 border border-orange-800/60 px-2 py-0.5 text-xs text-orange-400">
              {thisWeek.length}
            </span>
          </div>
          {thisWeek.length === 0 ? (
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-5 text-center text-xs text-slate-600">
              Nothing due this week
            </div>
          ) : (
            <div className="rounded-lg border border-orange-900/40 bg-slate-800/30 divide-y divide-slate-700/40">
              {thisWeek.map(item => (
                <DeadlineRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Next Week */}
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Next Week
            </h3>
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-500">
              {nextWeek.length}
            </span>
          </div>
          {nextWeek.length === 0 ? (
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-5 text-center text-xs text-slate-600">
              Nothing due next week
            </div>
          ) : (
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 divide-y divide-slate-700/40">
              {nextWeek.map(item => (
                <DeadlineRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [stats, setStats] = useState<PortfolioStats>({
    active: 0, atRisk: 0, onTrack: 0, overdue: 0, completed: 0,
  });
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [combined, setCombined] = useState<CombinedDeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolioWithMilestones();
      setTeams(data);
      setStats(computeStats(data));
      setDeadlines(computeDeadlines(data));
      setCombined(computeCombinedDeadlines(data, 14)); // only 14d for the weekly section
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error fetching data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalProjects  = teams.flatMap(t => t.projects.nodes).length;
  const activeProjects = teams.flatMap(t => t.projects.nodes).filter(p => p.state === 'started').length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            Colvin Run Networks — Program Dashboard
          </h1>
          <p className="text-sm text-slate-500">
            {teams.length > 0
              ? `${teams.length} teams · ${activeProjects} active / ${totalProjects} total projects`
              : 'SBIR Portfolio Overview · Leadership Briefing View'
            }
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error loading data:</strong> {error}
        </div>
      )}

      {loading && teams.length === 0 && (
        <div className="flex items-center justify-center py-24">
          <div className="text-sm text-slate-500">Loading portfolio data…</div>
        </div>
      )}

      {(!loading || teams.length > 0) && (
        <>
          <StatsRow stats={stats} />

          {/* Weekly deadlines — projects + milestones due this week and next */}
          <WeeklyDeadlinesSection items={combined} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <DeadlinePanel deadlines={deadlines} className="lg:col-span-1" />
            <div className="hidden lg:col-span-2 lg:flex items-center justify-center rounded-lg border border-dashed border-slate-700/50 text-sm text-slate-700">
              Activity feed — coming soon
            </div>
          </div>

          {teams.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                Programs by Team
              </h2>
              <div className="flex flex-col gap-4">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
