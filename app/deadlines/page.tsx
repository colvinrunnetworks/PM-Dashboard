'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Flag,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import {
  cn,
  computeCombinedDeadlines,
  formatDate,
  milestoneStatusClasses,
  milestoneStatusLabel,
} from '@/lib/utils';
import { ProgressBar } from '@/components/ProgressBar';
import { RefreshButton } from '@/components/RefreshButton';
import type { CombinedDeadlineItem } from '@/lib/types';

// ── Window options ─────────────────────────────────────────────────────────────

const WINDOWS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
] as const;

// ── Urgency helpers ────────────────────────────────────────────────────────────

function urgencyBadgeClasses(days: number): string {
  if (days <= 3)  return 'bg-red-900/60 text-red-300 border border-red-700';
  if (days <= 7)  return 'bg-orange-900/60 text-orange-300 border border-orange-700';
  if (days <= 14) return 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/60';
  return 'bg-slate-800/60 text-slate-400 border border-slate-700';
}

function urgencyLabel(days: number): string {
  if (days === 0) return 'Due today';
  if (days === 1) return '1 day';
  return `${days}d`;
}

// ── Row component ──────────────────────────────────────────────────────────────

function DeadlineRow({ item }: { item: CombinedDeadlineItem }) {
  const isMilestone = item.kind === 'milestone';

  return (
    <Link
      href={`/programs/${item.teamId}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-700/25"
    >
      {/* Team color stripe */}
      <span
        className="h-10 w-0.5 rounded-full shrink-0"
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
          <span className="text-sm font-medium text-slate-200 truncate">
            {item.label}
          </span>
          {isMilestone && (
            <span className="text-xs text-slate-500 truncate">
              {item.projectName}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
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
          <span>{formatDate(item.targetDate)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="w-28 shrink-0 hidden sm:block">
        <ProgressBar progress={item.progress} height="sm" showLabel={false} />
        <div className="mt-0.5 text-right text-xs text-slate-600">
          {Math.round(item.progress * 100)}%
        </div>
      </div>

      {/* Urgency badge */}
      <div className={cn('shrink-0 rounded px-2 py-1 text-xs font-semibold tabular-nums', urgencyBadgeClasses(item.daysUntil))}>
        {urgencyLabel(item.daysUntil)}
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-slate-700 group-hover:text-slate-400 shrink-0 transition-colors" />
    </Link>
  );
}

// ── Grouped view ──────────────────────────────────────────────────────────────

type GroupBy = 'date' | 'team';

function groupByDate(items: CombinedDeadlineItem[]): { label: string; items: CombinedDeadlineItem[] }[] {
  const buckets: Record<string, CombinedDeadlineItem[]> = {
    'This Week (0–7d)': [],
    'Next Week (8–14d)': [],
    'This Month (15–30d)': [],
    'Later': [],
  };
  for (const item of items) {
    if (item.daysUntil <= 7)        buckets['This Week (0–7d)'].push(item);
    else if (item.daysUntil <= 14)  buckets['Next Week (8–14d)'].push(item);
    else if (item.daysUntil <= 30)  buckets['This Month (15–30d)'].push(item);
    else                            buckets['Later'].push(item);
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function groupByTeam(items: CombinedDeadlineItem[]): { label: string; color: string; items: CombinedDeadlineItem[] }[] {
  const map = new Map<string, { label: string; color: string; items: CombinedDeadlineItem[] }>();
  for (const item of items) {
    if (!map.has(item.teamId)) {
      map.set(item.teamId, { label: item.teamName, color: item.teamColor, items: [] });
    }
    map.get(item.teamId)!.items.push(item);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeadlinesPage() {
  const [items, setItems] = useState<CombinedDeadlineItem[]>([]);
  const [window, setWindow] = useState(30);
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [showMilestones, setShowMilestones] = useState(true);
  const [showProjects, setShowProjects] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teams = await fetchPortfolioWithMilestones();
      setItems(computeCombinedDeadlines(teams, 90)); // always fetch 90d, filter in UI
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply filters
  const filtered = items.filter((item) => {
    if (item.daysUntil > window) return false;
    if (!showMilestones && item.kind === 'milestone') return false;
    if (!showProjects && item.kind === 'project') return false;
    return true;
  });

  const projectCount   = filtered.filter((i) => i.kind === 'project').length;
  const milestoneCount = filtered.filter((i) => i.kind === 'milestone').length;

  const dateGroups = groupBy === 'date' ? groupByDate(filtered) : null;
  const teamGroups = groupBy === 'team' ? groupByTeam(filtered) : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-400" />
            Deadlines &amp; Milestones
          </h1>
          <p className="text-sm text-slate-500">
            Upcoming project deadlines and Linear milestones
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Window selector */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                window === w.value
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
          {(['date', 'team'] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                groupBy === g
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              By {g}
            </button>
          ))}
        </div>

        {/* Kind toggles */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowProjects((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              showProjects
                ? 'border-blue-700 bg-blue-900/40 text-blue-300'
                : 'border-slate-700 text-slate-500 hover:text-slate-300'
            )}
          >
            <Layers className="h-3 w-3" />
            Projects
            <span className="tabular-nums">{projectCount}</span>
          </button>
          <button
            onClick={() => setShowMilestones((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              showMilestones
                ? 'border-orange-700 bg-orange-900/40 text-orange-300'
                : 'border-slate-700 text-slate-500 hover:text-slate-300'
            )}
          >
            <Flag className="h-3 w-3" />
            Milestones
            <span className="tabular-nums">{milestoneCount}</span>
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && filtered.length === 0 && (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">Loading…</div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && !error && (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">
          No deadlines in the next {window} days.
        </div>
      )}

      {/* Grouped content */}
      {filtered.length > 0 && (
        <div className="flex flex-col gap-5">
          {/* By Date */}
          {dateGroups?.map((group) => (
            <section key={group.label}>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                  {group.items.length}
                </span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 divide-y divide-slate-700/40">
                {group.items.map((item) => (
                  <DeadlineRow key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </div>
            </section>
          ))}

          {/* By Team */}
          {teamGroups?.map((group) => (
            <section key={group.label}>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                  {group.items.length}
                </span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 divide-y divide-slate-700/40">
                {group.items.map((item) => (
                  <DeadlineRow key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
