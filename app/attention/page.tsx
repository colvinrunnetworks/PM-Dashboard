'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Clock, User, CalendarRange,
  CheckCircle2, TrendingDown, ExternalLink, PauseCircle,
  CalendarX, UserX, Activity, Gauge,
} from 'lucide-react';
import { fetchPortfolio } from '@/lib/api';
import {
  cn, isAtRisk, isOverdue, daysUntil, formatDate, formatLeadName,
  healthClasses, healthLabel,
} from '@/lib/utils';
import { ProgressBar } from '@/components/ProgressBar';
import { StatusBadge } from '@/components/StatusBadge';
import { CUIBadge } from '@/components/CUIBadge';
import { RefreshButton } from '@/components/RefreshButton';
import type { Team, Project } from '@/lib/types';

// ── Flag types ────────────────────────────────────────────────────────────────

type FlagKey = 'overdue' | 'at-risk' | 'due-soon' | 'on-hold' | 'stalled' | 'no-date' | 'no-lead' | 'no-health';

const FLAG_META: Record<FlagKey, {
  label: string;
  icon: React.ReactNode;
  chipActive: string;
  chipInactive: string;
  badge: string;
}> = {
  'overdue':   { label: 'Overdue',        icon: <Clock className="h-3.5 w-3.5" />,        chipActive: 'bg-red-600/25 text-red-300 border-red-500/60',      chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-red-950/60 text-red-400 border-red-700/60' },
  'at-risk':   { label: 'At Risk',        icon: <AlertTriangle className="h-3.5 w-3.5" />, chipActive: 'bg-orange-600/25 text-orange-300 border-orange-500/60', chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-orange-950/60 text-orange-400 border-orange-700/60' },
  'due-soon':  { label: 'Due Soon',       icon: <CalendarRange className="h-3.5 w-3.5" />, chipActive: 'bg-yellow-600/25 text-yellow-300 border-yellow-500/60', chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-yellow-950/60 text-yellow-400 border-yellow-700/60' },
  'on-hold':   { label: 'On Hold',        icon: <PauseCircle className="h-3.5 w-3.5" />,   chipActive: 'bg-blue-600/25 text-blue-300 border-blue-500/60',       chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-blue-950/60 text-blue-400 border-blue-700/60' },
  'stalled':   { label: 'Stalled',        icon: <Activity className="h-3.5 w-3.5" />,      chipActive: 'bg-purple-600/25 text-purple-300 border-purple-500/60',  chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-purple-950/60 text-purple-400 border-purple-700/60' },
  'no-date':   { label: 'No Deadline',    icon: <CalendarX className="h-3.5 w-3.5" />,     chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60' },
  'no-lead':   { label: 'No Lead',        icon: <UserX className="h-3.5 w-3.5" />,         chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60' },
  'no-health': { label: 'Health Not Set', icon: <Gauge className="h-3.5 w-3.5" />,         chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60' },
};

const FLAG_ORDER: FlagKey[] = ['overdue', 'at-risk', 'due-soon', 'stalled', 'on-hold', 'no-date', 'no-lead', 'no-health'];

// ── Data model ────────────────────────────────────────────────────────────────

interface FlaggedProject {
  project: Project;
  team: Team;
  flags: FlagKey[];
  daysLeft: number | null;
}

function collectFlagged(teams: Team[]): FlaggedProject[] {
  const result: FlaggedProject[] = [];

  for (const team of teams) {
    for (const project of team.projects.nodes) {
      const isActive = project.state !== 'completed' && project.state !== 'cancelled';
      const flags: FlagKey[] = [];
      const days = project.targetDate ? daysUntil(project.targetDate) : null;

      // Operational flags
      if (isOverdue(project)) {
        flags.push('overdue');
      } else if (isAtRisk(project)) {
        flags.push('at-risk');
      } else if (isActive && days !== null && days >= 0 && days <= 30 && project.progress < 0.5) {
        flags.push('due-soon');
      }

      // On hold — all paused projects regardless of other flags
      if (project.state === 'paused') flags.push('on-hold');

      // Stalled — started, 0% progress, start date already passed
      if (
        project.state === 'started' &&
        project.progress === 0 &&
        project.startDate &&
        daysUntil(project.startDate) < 0
      ) {
        flags.push('stalled');
      }

      // Admin hygiene
      if (isActive && !project.targetDate) flags.push('no-date');
      if (isActive && !project.lead)       flags.push('no-lead');
      if (isActive && project.health === null) flags.push('no-health');

      if (flags.length > 0) {
        result.push({ project, team, flags, daysLeft: days });
      }
    }
  }

  // Sort by highest-priority flag first, then by days left
  result.sort((a, b) => {
    const aIdx = Math.min(...a.flags.map(f => FLAG_ORDER.indexOf(f)));
    const bIdx = Math.min(...b.flags.map(f => FLAG_ORDER.indexOf(f)));
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  });

  return result;
}

// ── Filter chips ──────────────────────────────────────────────────────────────

function FilterChips({
  items,
  active,
  onSelect,
}: {
  items: FlaggedProject[];
  active: FlagKey | null;
  onSelect: (f: FlagKey | null) => void;
}) {
  const counts = useMemo(() => {
    const map: Partial<Record<FlagKey, number>> = {};
    for (const item of items) {
      for (const f of item.flags) {
        map[f] = (map[f] ?? 0) + 1;
      }
    }
    return map;
  }, [items]);

  // Deduplicate — total unique projects shown in "All"
  const totalUnique = items.length;

  return (
    <div className="flex flex-wrap gap-2">
      {/* All chip */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          active === null
            ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
            : 'text-slate-400 border-slate-700 hover:border-slate-500'
        )}
      >
        All
        <span className={cn(
          'rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
          active === null ? 'bg-blue-500/30 text-blue-200' : 'bg-slate-700 text-slate-400'
        )}>
          {totalUnique}
        </span>
      </button>

      {/* Per-flag chips — only show flags that have at least 1 project */}
      {FLAG_ORDER.filter(f => (counts[f] ?? 0) > 0).map(f => {
        const meta = FLAG_META[f];
        const count = counts[f] ?? 0;
        const isActive = active === f;
        return (
          <button
            key={f}
            onClick={() => onSelect(isActive ? null : f)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive ? meta.chipActive : meta.chipInactive
            )}
          >
            {meta.icon}
            {meta.label}
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
              isActive ? 'bg-white/10 text-inherit' : 'bg-slate-700 text-slate-400'
            )}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Attention card ────────────────────────────────────────────────────────────

function timeLabel(item: FlaggedProject): { text: string; className: string } {
  if (item.flags.includes('overdue')) {
    const d = item.daysLeft;
    const text = d === null ? 'No target date' : d === 0 ? 'Due today' : `${Math.abs(d)}d overdue`;
    return { text, className: 'text-red-400 font-semibold' };
  }
  if (item.flags.includes('at-risk') || item.flags.includes('due-soon')) {
    const d = item.daysLeft;
    const text = d === null ? '' : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `${d}d left`;
    const className = d !== null && d <= 7 ? 'text-orange-400 font-semibold' : 'text-yellow-400 font-medium';
    return { text, className };
  }
  return { text: '', className: '' };
}

function AttentionCard({ item }: { item: FlaggedProject }) {
  const { project, team } = item;
  const tl = timeLabel(item);
  const isOverdueItem = item.flags.includes('overdue');
  const borderColor = isOverdueItem ? '#ef444430' : item.flags.includes('at-risk') ? '#f9731630' : '#33415540';
  const headerBg = isOverdueItem ? 'bg-red-950/20' : item.flags.includes('at-risk') ? 'bg-orange-950/15' : 'bg-slate-800/20';

  return (
    <div className="rounded-lg border bg-slate-800/40 transition-shadow hover:shadow-md" style={{ borderColor }}>
      {/* Header */}
      <div className={cn('flex items-center gap-3 rounded-t-lg px-4 py-2.5', headerBg)}>
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
        <span className="text-xs font-medium text-slate-400">{team.name}</span>
        <span className="ml-1 rounded px-1 py-0.5 font-mono text-xs" style={{ color: team.color, backgroundColor: `${team.color}20` }}>
          {team.key}
        </span>
        {team.isCUI && <CUIBadge compact />}
        {tl.text && <span className={cn('ml-auto text-sm shrink-0', tl.className)}>{tl.text}</span>}
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Name + status */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-blue-300 transition-colors leading-snug"
            >
              {project.name}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {project.lead ? (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />{formatLeadName(project.lead.name)}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-600 italic">
                  <UserX className="h-3 w-3" />No lead
                </span>
              )}
              {project.startDate && (
                <span className="flex items-center gap-1">
                  <CalendarRange className="h-3 w-3" />
                  {formatDate(project.startDate)}
                  {project.targetDate && ` → ${formatDate(project.targetDate)}`}
                </span>
              )}
              {!project.startDate && project.targetDate && (
                <span className="flex items-center gap-1">
                  <CalendarRange className="h-3 w-3" />Target: {formatDate(project.targetDate)}
                </span>
              )}
              {!project.targetDate && (
                <span className="flex items-center gap-1 text-slate-600 italic">
                  <CalendarX className="h-3 w-3" />No deadline set
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge state={project.state} />
            {project.health && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', healthClasses(project.health))}>
                {healthLabel(project.health)}
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="mb-1 flex items-center justify-end text-xs">
            <span className={project.progress < 0.25 ? 'text-red-400' : 'text-slate-500'}>
              {Math.round(project.progress * 100)}% complete
            </span>
          </div>
          <ProgressBar progress={project.progress} height="md" showLabel={false} />
        </div>

        {/* Issues */}
        {(project.issues?.nodes ?? []).length > 0 && (
          <div className="border-t border-slate-700/40 pt-2">
            <div className="mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
              Open Issues ({project.issues!.nodes.length})
            </div>
            <ul className="space-y-1">
              {project.issues!.nodes.slice(0, 3).map((issue) => (
                <li key={issue.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-600 shrink-0" />
                  <span className="truncate">{issue.title}</span>
                  <span className="shrink-0 text-slate-600">{issue.state.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Flag badges */}
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-700/30">
          {item.flags.map(f => (
            <span key={f} className={cn('flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium', FLAG_META[f].badge)}>
              {FLAG_META[f].icon}
              {FLAG_META[f].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function AllClearBanner() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-green-800/40 bg-green-950/20 py-16">
      <CheckCircle2 className="h-12 w-12 text-green-500/60" />
      <div className="text-center">
        <div className="text-lg font-semibold text-green-400">All clear</div>
        <div className="mt-1 text-sm text-slate-500">No flagged projects right now.</div>
      </div>
    </div>
  );
}

function EmptyFilter({ flag }: { flag: FlagKey }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-700/40 bg-slate-800/20 py-12">
      <CheckCircle2 className="h-8 w-8 text-slate-600" />
      <div className="text-sm text-slate-500">No projects flagged as <span className="text-slate-400 font-medium">{FLAG_META[flag].label}</span>.</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttentionPage() {
  const [allItems, setAllItems] = useState<FlaggedProject[]>([]);
  const [activeFilter, setActiveFilter] = useState<FlagKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teams = await fetchPortfolio();
      setAllItems(collectFlagged(teams));
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleItems = useMemo(() => {
    if (!activeFilter) return allItems;
    return allItems.filter(item => item.flags.includes(activeFilter));
  }, [allItems, activeFilter]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-400" />
            Needs Attention
          </h1>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${allItems.length} flagged project${allItems.length !== 1 ? 's' : ''} across all teams`}
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error loading data:</strong> {error}
        </div>
      )}

      {loading && allItems.length === 0 && (
        <div className="flex items-center justify-center py-24 text-sm text-slate-500">Loading…</div>
      )}

      {(!loading || allItems.length > 0) && !error && (
        <>
          {allItems.length === 0 ? (
            <AllClearBanner />
          ) : (
            <>
              <FilterChips items={allItems} active={activeFilter} onSelect={setActiveFilter} />

              {visibleItems.length === 0 && activeFilter ? (
                <EmptyFilter flag={activeFilter} />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {visibleItems.map(item => (
                    <AttentionCard key={item.project.id} item={item} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
