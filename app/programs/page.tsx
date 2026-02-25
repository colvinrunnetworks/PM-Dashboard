'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  FolderKanban,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Circle,
  Search,
  Flag,
  X,
} from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import { cn, isAtRisk, isOverdue, formatLeadName, formatDate, daysUntil, progressColor } from '@/lib/utils';
import { CUIBadge } from '@/components/CUIBadge';
import { RefreshButton } from '@/components/RefreshButton';
import type { Team, Project } from '@/lib/types';

// ── Per-team stats ─────────────────────────────────────────────────────────────

interface TeamStats {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  atRisk: number;
  milestoneCount: number;
  overdueMilestones: number;
  avgProgress: number;       // 0–1, across active projects
  nextDeadline: string | null;
  nextDeadlineDays: number | null;
}

function computeTeamStats(team: Team): TeamStats {
  const projects = team.projects.nodes;
  const active = projects.filter(p => p.state === 'started');
  const completed = projects.filter(p => p.state === 'completed');
  const overdueList = projects.filter(p => isOverdue(p));
  const atRiskList = projects.filter(p => isAtRisk(p));

  // Milestone counts
  let milestoneCount = 0;
  let overdueMilestones = 0;
  for (const p of projects) {
    for (const ms of (p.projectMilestones?.nodes ?? [])) {
      if (ms.status === 'done') continue;
      milestoneCount++;
      if (ms.status === 'overdue') overdueMilestones++;
    }
  }

  // Average progress across active projects
  const avgProgress = active.length > 0
    ? active.reduce((sum, p) => sum + p.progress, 0) / active.length
    : 0;

  // Find the soonest upcoming deadline across all non-completed projects
  const upcoming = projects
    .filter(p => p.state !== 'completed' && p.state !== 'cancelled' && p.targetDate)
    .map(p => ({ date: p.targetDate!, days: daysUntil(p.targetDate!) }))
    .filter(x => x.days >= 0)
    .sort((a, b) => a.days - b.days);

  return {
    total:             projects.length,
    active:            active.length,
    completed:         completed.length,
    overdue:           overdueList.length,
    atRisk:            atRiskList.length,
    milestoneCount,
    overdueMilestones,
    avgProgress,
    nextDeadline:      upcoming[0]?.date ?? null,
    nextDeadlineDays:  upcoming[0]?.days ?? null,
  };
}

// ── Status chip ────────────────────────────────────────────────────────────────

function TeamStatusChip({ stats }: { stats: TeamStats }) {
  if (stats.overdue > 0) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-red-700 bg-red-950/50 px-2 py-0.5 text-xs font-medium text-red-400">
        <Clock className="h-3 w-3" />
        {stats.overdue} overdue
      </span>
    );
  }
  if (stats.atRisk > 0) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-orange-700 bg-orange-950/50 px-2 py-0.5 text-xs font-medium text-orange-400">
        <AlertTriangle className="h-3 w-3" />
        {stats.atRisk} at risk
      </span>
    );
  }
  if (stats.active === 0 && stats.total > 0) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/50 px-2 py-0.5 text-xs text-slate-500">
        <Circle className="h-3 w-3" />
        No active
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full border border-green-800 bg-green-950/40 px-2 py-0.5 text-xs font-medium text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      On track
    </span>
  );
}

// ── Deadline urgency ───────────────────────────────────────────────────────────

function deadlineDateClass(days: number): string {
  if (days <= 7)  return 'text-orange-400 font-medium';
  if (days <= 14) return 'text-yellow-400';
  return 'text-slate-400';
}

// ── Mini progress bar ──────────────────────────────────────────────────────────

function MiniProgressBar({ progress, color }: { progress: number; color: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-xs tabular-nums text-slate-500">
        {pct}%
      </span>
    </div>
  );
}

// ── Team card ──────────────────────────────────────────────────────────────────

function TeamSummaryCard({ team }: { team: Team }) {
  const stats = computeTeamStats(team);

  // Active projects sorted: overdue first, then at-risk, then by name
  const activeProjects = team.projects.nodes
    .filter(p => p.state !== 'completed' && p.state !== 'cancelled')
    .sort((a, b) => {
      const aOver = isOverdue(a) ? 0 : isAtRisk(a) ? 1 : 2;
      const bOver = isOverdue(b) ? 0 : isAtRisk(b) ? 1 : 2;
      return aOver - bOver || a.name.localeCompare(b.name);
    });

  return (
    <Link
      href={`/programs/${team.id}`}
      className="group block rounded-lg border bg-slate-800/40 transition-all hover:shadow-lg hover:bg-slate-800/60"
      style={{ borderColor: `${team.color}40` }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 rounded-t-lg px-4 py-3"
        style={{ borderBottom: `1px solid ${team.color}25` }}
      >
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: team.color }}
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
            {team.name}
          </h3>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-xs font-medium"
            style={{ color: team.color, backgroundColor: `${team.color}20` }}
          >
            {team.key}
          </span>
        </div>
        {team.isCUI && <CUIBadge compact />}
        <TeamStatusChip stats={stats} />
        <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-700/30">
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-300">{stats.active}</span> active
        </span>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-300">{stats.completed}</span> done
        </span>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-300">{stats.total}</span> total
        </span>
        {stats.milestoneCount > 0 && (
          <span className={cn(
            'flex items-center gap-1 text-xs',
            stats.overdueMilestones > 0 ? 'text-red-400' : 'text-slate-500'
          )}>
            <Flag className="h-3 w-3" />
            <span className={stats.overdueMilestones > 0 ? 'font-semibold' : ''}>
              {stats.milestoneCount}
            </span>
            {stats.overdueMilestones > 0 && (
              <span className="text-red-500">({stats.overdueMilestones} overdue)</span>
            )}
          </span>
        )}
        {stats.nextDeadline && stats.nextDeadlineDays !== null && (
          <span className={cn('ml-auto text-xs', deadlineDateClass(stats.nextDeadlineDays))}>
            Next: {formatDate(stats.nextDeadline)}
            <span className="ml-1 text-slate-600">({stats.nextDeadlineDays}d)</span>
          </span>
        )}
      </div>

      {/* Progress bar (avg across active projects) */}
      {stats.active > 0 && (
        <div className="px-4 py-2 border-b border-slate-700/20">
          <MiniProgressBar progress={stats.avgProgress} color={team.color} />
        </div>
      )}

      {/* Active project list (up to 4) */}
      {activeProjects.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-600">
          No active projects
        </div>
      ) : (
        <ul className="divide-y divide-slate-700/25">
          {activeProjects.slice(0, 4).map((project: Project) => {
            const over = isOverdue(project);
            const risk = isAtRisk(project);
            const msNodes = project.projectMilestones?.nodes ?? [];
            const activeMsCount = msNodes.filter(ms => ms.status !== 'done').length;
            return (
              <li key={project.id} className="flex items-center gap-2.5 px-4 py-2">
                {/* Status dot */}
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  over  ? 'bg-red-500'    :
                  risk  ? 'bg-orange-500' :
                  project.state === 'started' ? 'bg-blue-500' : 'bg-slate-600'
                )} />
                {/* Name */}
                <span className="flex-1 truncate text-xs text-slate-300">
                  {project.name}
                </span>
                {/* Milestone count */}
                {activeMsCount > 0 && (
                  <span className="shrink-0 flex items-center gap-0.5 text-xs text-slate-600">
                    <Flag className="h-2.5 w-2.5" />
                    {activeMsCount}
                  </span>
                )}
                {/* Lead */}
                {project.lead && (
                  <span className="shrink-0 text-xs text-slate-600">
                    {formatLeadName(project.lead.name)}
                  </span>
                )}
                {/* Date */}
                {project.targetDate && (
                  <span className={cn('shrink-0 text-xs', over ? 'text-red-400' : risk ? 'text-orange-400' : 'text-slate-600')}>
                    {formatDate(project.targetDate)}
                  </span>
                )}
              </li>
            );
          })}
          {activeProjects.length > 4 && (
            <li className="px-4 py-1.5 text-xs text-slate-600">
              +{activeProjects.length - 4} more
            </li>
          )}
        </ul>
      )}
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'attention'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolioWithMilestones();
      setTeams(data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let result = teams;

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(team =>
        team.name.toLowerCase().includes(q) ||
        team.key.toLowerCase().includes(q)
      );
    }

    // Status filter
    result = result.filter(team => {
      if (filter === 'all') return true;
      const stats = computeTeamStats(team);
      if (filter === 'active') return stats.active > 0;
      if (filter === 'attention') return stats.overdue > 0 || stats.atRisk > 0;
      return true;
    });

    return result;
  }, [teams, filter, search]);

  // Sort: teams with overdue/at-risk first, then by name
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const sa = computeTeamStats(a);
    const sb = computeTeamStats(b);
    const aPriority = sa.overdue > 0 ? 0 : sa.atRisk > 0 ? 1 : sa.active > 0 ? 2 : 3;
    const bPriority = sb.overdue > 0 ? 0 : sb.atRisk > 0 ? 1 : sb.active > 0 ? 2 : 3;
    return aPriority - bPriority || a.name.localeCompare(b.name);
  }), [filtered]);

  const FILTERS = [
    { key: 'all',       label: 'All Programs' },
    { key: 'active',    label: 'Active' },
    { key: 'attention', label: 'Needs Attention' },
  ] as const;

  // Summary counts
  const totalProjects = teams.flatMap(t => t.projects.nodes).length;
  const activeProjects = teams.flatMap(t => t.projects.nodes).filter(p => p.state === 'started').length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-blue-400" />
            Programs
          </h1>
          <p className="text-sm text-slate-500">
            {teams.length} teams · {activeProjects} active / {totalProjects} total projects
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

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search teams…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-48 rounded-lg border border-slate-700 bg-slate-800/60 pl-8 pr-7 text-xs text-slate-200 placeholder-slate-600 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && teams.length === 0 && (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">
          Loading programs…
        </div>
      )}

      {/* Grid */}
      {sorted.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sorted.map(team => (
            <TeamSummaryCard key={team.id} team={team} />
          ))}
        </div>
      )}

      {!loading && sorted.length === 0 && !error && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          {search ? `No programs match "${search}".` : 'No programs match this filter.'}
        </div>
      )}
    </div>
  );
}
