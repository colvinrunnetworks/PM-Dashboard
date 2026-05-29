'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Clock, User, CalendarRange,
  CheckCircle2, ShieldAlert, ExternalLink, PauseCircle,
  CalendarX, UserX, Activity, Gauge, Inbox,
} from 'lucide-react';
import { fetchPortfolio, fetchBacklogByProject } from '@/lib/api';
import type { BacklogIssue, BacklogMap } from '@/lib/api';
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

type FlagKey = 'overdue' | 'at-risk' | 'due-soon' | 'on-hold' | 'stalled' | 'no-date' | 'no-lead' | 'no-health' | 'backlog';

const FLAG_META: Record<FlagKey, {
  label: string;
  icon: React.ReactNode;
  chipActive: string;
  chipInactive: string;
  badge: string;
  row: string;
}> = {
  'overdue':   { label: 'Overdue',          icon: <Clock className="h-3.5 w-3.5" />,        chipActive: 'bg-red-600/25 text-red-300 border-red-500/60',       chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-red-950/60 text-red-400 border-red-700/60',      row: 'text-red-400' },
  'at-risk':   { label: 'At Risk',          icon: <AlertTriangle className="h-3.5 w-3.5" />, chipActive: 'bg-orange-600/25 text-orange-300 border-orange-500/60', chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-orange-950/60 text-orange-400 border-orange-700/60', row: 'text-orange-400' },
  'due-soon':  { label: 'Due Soon',         icon: <CalendarRange className="h-3.5 w-3.5" />, chipActive: 'bg-yellow-600/25 text-yellow-300 border-yellow-500/60', chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-yellow-950/60 text-yellow-400 border-yellow-700/60', row: 'text-yellow-400' },
  'on-hold':   { label: 'On Hold',          icon: <PauseCircle className="h-3.5 w-3.5" />,   chipActive: 'bg-blue-600/25 text-blue-300 border-blue-500/60',       chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-blue-950/60 text-blue-400 border-blue-700/60',    row: 'text-blue-400' },
  'stalled':   { label: 'Stalled',          icon: <Activity className="h-3.5 w-3.5" />,      chipActive: 'bg-purple-600/25 text-purple-300 border-purple-500/60',  chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-purple-950/60 text-purple-400 border-purple-700/60', row: 'text-purple-400' },
  'no-date':   { label: 'No Deadline',      icon: <CalendarX className="h-3.5 w-3.5" />,     chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60', row: 'text-slate-400' },
  'no-lead':   { label: 'No Lead',          icon: <UserX className="h-3.5 w-3.5" />,         chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60', row: 'text-slate-400' },
  'no-health': { label: 'Health Not Set',   icon: <Gauge className="h-3.5 w-3.5" />,         chipActive: 'bg-slate-600/30 text-slate-300 border-slate-500/60',    chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-slate-800/60 text-slate-400 border-slate-600/60', row: 'text-slate-400' },
  'backlog':   { label: 'Backlog Issues',   icon: <Inbox className="h-3.5 w-3.5" />,         chipActive: 'bg-amber-600/25 text-amber-300 border-amber-500/60',     chipInactive: 'text-slate-400 border-slate-700 hover:border-slate-500', badge: 'bg-amber-950/60 text-amber-400 border-amber-700/60', row: 'text-amber-400' },
};

const FLAG_ORDER: FlagKey[] = ['overdue', 'at-risk', 'due-soon', 'stalled', 'on-hold', 'no-date', 'no-lead', 'no-health', 'backlog'];

// ── Data model ────────────────────────────────────────────────────────────────

interface FlaggedProject {
  project: Project;
  team: Team;
  flags: FlagKey[];
  daysLeft: number | null;
  backlogIssues: BacklogIssue[];
}

function collectFlagged(teams: Team[], backlogMap: BacklogMap = {}): FlaggedProject[] {
  const result: FlaggedProject[] = [];
  const seen = new Set<string>();

  for (const team of teams) {
    for (const project of team.projects.nodes) {
      if (seen.has(project.id)) continue;
      seen.add(project.id);

      const isActive = project.state !== 'completed' && project.state !== 'cancelled';
      const flags: FlagKey[] = [];
      const days = project.targetDate ? daysUntil(project.targetDate) : null;

      if (isOverdue(project)) {
        flags.push('overdue');
      } else if (isAtRisk(project)) {
        flags.push('at-risk');
      } else if (isActive && days !== null && days >= 0 && days <= 30 && project.progress < 0.5) {
        flags.push('due-soon');
      }

      if (project.state === 'paused') flags.push('on-hold');

      if (
        project.state === 'started' &&
        project.progress === 0 &&
        project.startDate &&
        daysUntil(project.startDate) < 0
      ) {
        flags.push('stalled');
      }

      if (isActive && !project.targetDate) flags.push('no-date');
      if (isActive && !project.lead)       flags.push('no-lead');
      if (isActive && project.health === null) flags.push('no-health');

      const backlogIssues = isActive ? (backlogMap[project.id] ?? []) : [];
      if (isActive && backlogIssues.length > 0) flags.push('backlog');

      if (flags.length > 0) {
        result.push({ project, team, flags, daysLeft: days, backlogIssues });
      }
    }
  }

  result.sort((a, b) => {
    const aIdx = Math.min(...a.flags.map(f => FLAG_ORDER.indexOf(f)));
    const bIdx = Math.min(...b.flags.map(f => FLAG_ORDER.indexOf(f)));
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  });

  return result;
}

// ── Flag sub-label (brief, shown inside card cell when active) ────────────────

function flagSub(flag: FlagKey, item: FlaggedProject): string {
  switch (flag) {
    case 'overdue':
      return item.daysLeft === null ? '' : item.daysLeft === 0 ? 'today' : `${Math.abs(item.daysLeft)}d`;
    case 'at-risk':
    case 'due-soon':
      return item.daysLeft !== null ? `${item.daysLeft}d left` : '';
    case 'stalled':
      return item.project.startDate ? `${Math.abs(daysUntil(item.project.startDate))}d ago` : '';
    case 'backlog':
      return `${item.backlogIssues.length} issues`;
    default:
      return '';
  }
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

  return (
    <div className="flex flex-wrap gap-2">
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
          {items.length}
        </span>
      </button>

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

// ── Risk Card ─────────────────────────────────────────────────────────────────

function RiskCard({ item }: { item: FlaggedProject }) {
  const { project, team } = item;
  const isOverdueItem = item.flags.includes('overdue');
  const isAtRiskItem  = item.flags.includes('at-risk');
  const borderColor   = isOverdueItem ? '#ef444435' : isAtRiskItem ? '#f9731635' : '#33415540';

  return (
    <div className="rounded-lg border bg-slate-800/40 flex flex-col" style={{ borderColor }}>

      {/* ── Header: team + project ── */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3 border-b border-slate-700/40">
        <div className="flex-1 min-w-0">
          {/* Team line */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
            <span className="text-xs text-slate-500">{team.name}</span>
            <span className="rounded px-1 py-0.5 font-mono text-xs" style={{ color: team.color, backgroundColor: `${team.color}20` }}>
              {team.key}
            </span>
            {team.isCUI && <CUIBadge compact />}
          </div>
          {/* Project name */}
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-blue-300 transition-colors leading-snug"
          >
            {project.name}
            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
          </a>
          {/* Meta: lead · dates */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              {project.lead
                ? <><User className="h-3 w-3" />{formatLeadName(project.lead.name)}</>
                : <><UserX className="h-3 w-3 text-slate-600" /><span className="italic text-slate-600">No lead</span></>
              }
            </span>
            {(project.startDate || project.targetDate) && (
              <span className="flex items-center gap-1">
                <CalendarRange className="h-3 w-3" />
                {project.startDate ? formatDate(project.startDate) : '—'}
                {project.targetDate && ` → ${formatDate(project.targetDate)}`}
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

      {/* ── Risk scorecard: all categories ── */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2">
        {FLAG_ORDER.map(f => {
          const active = item.flags.includes(f);
          const sub    = active ? flagSub(f, item) : '';
          return (
            <div
              key={f}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                active ? FLAG_META[f].badge : 'border-slate-800 text-slate-700 bg-transparent'
              )}
            >
              <span className={active ? '' : 'opacity-30'}>{FLAG_META[f].icon}</span>
              <span className="truncate leading-tight">
                {FLAG_META[f].label}
                {sub && <span className="ml-1 font-normal opacity-80">{sub}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Progress ── */}
      <div className="px-4 pb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Progress</span>
          <span className={project.progress < 0.25 ? 'text-red-400 font-medium' : ''}>
            {Math.round(project.progress * 100)}%
          </span>
        </div>
        <ProgressBar progress={project.progress} height="md" showLabel={false} />
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
  const [allItems, setAllItems]         = useState<FlaggedProject[]>([]);
  const [activeFilter, setActiveFilter] = useState<FlagKey | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teams, backlogMap] = await Promise.all([
        fetchPortfolio(),
        fetchBacklogByProject(),
      ]);
      setAllItems(collectFlagged(teams, backlogMap));
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Unique teams that have at least one flagged project
  const teamList = useMemo(() => {
    const seen = new Map<string, Team>();
    for (const item of allItems) {
      if (!seen.has(item.team.id)) seen.set(item.team.id, item.team);
    }
    return [...seen.values()];
  }, [allItems]);

  // Apply team filter first, then flag filter
  const teamFiltered = useMemo(
    () => selectedTeamId ? allItems.filter(i => i.team.id === selectedTeamId) : allItems,
    [allItems, selectedTeamId]
  );

  const visibleItems = useMemo(() => {
    if (!activeFilter) return teamFiltered;
    return teamFiltered.filter(item => item.flags.includes(activeFilter));
  }, [teamFiltered, activeFilter]);

  const filtersActive = selectedTeamId !== null || activeFilter !== null;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-400" />
            Risk Register
          </h1>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : filtersActive
              ? `${visibleItems.length} of ${allItems.length} flagged project${allItems.length !== 1 ? 's' : ''}`
              : `${allItems.length} flagged project${allItems.length !== 1 ? 's' : ''} across all teams`}
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
              {/* Team picker */}
              {teamList.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedTeamId(null)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      selectedTeamId === null
                        ? 'bg-blue-600/30 text-blue-300 border-blue-600/50'
                        : 'text-slate-400 border-slate-700 hover:bg-slate-800'
                    )}
                  >
                    All Teams
                  </button>
                  {teamList.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTeamId(prev => prev === t.id ? null : t.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                        selectedTeamId !== t.id && 'text-slate-400 border-slate-700 hover:bg-slate-800'
                      )}
                      style={selectedTeamId === t.id
                        ? { backgroundColor: `${t.color}25`, borderColor: `${t.color}80`, color: t.color }
                        : {}}
                    >
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Flag filter chips */}
              <FilterChips items={teamFiltered} active={activeFilter} onSelect={setActiveFilter} />

              {visibleItems.length === 0 && activeFilter ? (
                <EmptyFilter flag={activeFilter} />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {visibleItems.map(item => (
                    <RiskCard key={item.project.id} item={item} />
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
