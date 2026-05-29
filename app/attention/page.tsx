'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Clock, CalendarRange, Info,
  CheckCircle2, ShieldAlert, PauseCircle, ExternalLink, ChevronDown,
  CalendarX, UserX, Activity, Gauge, Inbox, User,
} from 'lucide-react';
import { fetchPortfolio, fetchBacklogByProject } from '@/lib/api';
import type { BacklogIssue, BacklogMap } from '@/lib/api';
import {
  cn, isAtRisk, isOverdue, daysUntil, formatDate, formatLeadName,
} from '@/lib/utils';
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



// ── Drill-down project list for a given flag ─────────────────────────────────

function DrillDownList({ items, flag }: { items: FlaggedProject[]; flag: FlagKey }) {
  const projects = items.filter(i => i.flags.includes(flag));
  const meta = FLAG_META[flag];

  return (
    <div className="border-t border-slate-700/40">
      <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-900/40">
        <span className={meta.row}>{meta.icon}</span>
        <span className={cn('text-xs font-semibold uppercase tracking-wider', meta.row)}>
          {meta.label} — {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-700/20">
        {projects.map(item => {
          const { project } = item;
          // Build a short context string for this flag
          let context = '';
          if (flag === 'overdue') {
            context = item.daysLeft === null ? '' : item.daysLeft === 0 ? 'Due today' : `${Math.abs(item.daysLeft)}d overdue`;
          } else if (flag === 'at-risk' || flag === 'due-soon') {
            context = item.daysLeft !== null ? `${item.daysLeft}d left` : '';
          } else if (flag === 'stalled' && project.startDate) {
            context = `started ${Math.abs(daysUntil(project.startDate))}d ago`;
          } else if (flag === 'backlog') {
            context = `${item.backlogIssues.length} issue${item.backlogIssues.length !== 1 ? 's' : ''}`;
          }

          return (
            <a
              key={project.id}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-200 group-hover:text-blue-300 transition-colors truncate block">
                  {project.name}
                </span>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                  {project.lead && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />{formatLeadName(project.lead.name)}
                    </span>
                  )}
                  {project.targetDate && (
                    <span className="flex items-center gap-1">
                      <CalendarRange className="h-3 w-3" />{formatDate(project.targetDate)}
                    </span>
                  )}
                </div>
              </div>
              {context && (
                <span className={cn('text-xs font-medium shrink-0', meta.row)}>{context}</span>
              )}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-blue-400 transition-colors" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Team risk card (compact scorecard + click-to-drill) ───────────────────────

function TeamRiskCard({ team, projects }: { team: Team; projects: FlaggedProject[] }) {
  const [openFlag, setOpenFlag] = useState<FlagKey | null>(null);

  const allFlags = projects.flatMap(p => p.flags);
  const hasOverdue  = allFlags.includes('overdue');
  const hasAtRisk   = allFlags.includes('at-risk');
  const borderColor = hasOverdue ? '#ef444435' : hasAtRisk ? '#f9731635' : '#33415540';

  const counts: Partial<Record<FlagKey, number>> = {};
  for (const f of allFlags) counts[f] = (counts[f] ?? 0) + 1;

  function toggleFlag(f: FlagKey) {
    setOpenFlag(prev => prev === f ? null : f);
  }

  return (
    <div className="rounded-lg border bg-slate-800/40" style={{ borderColor }}>
      {/* Team header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg"
        style={{ borderBottom: `1px solid ${team.color}25`, backgroundColor: `${team.color}0d` }}
      >
        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
        <span className="text-sm font-bold text-white">{team.name}</span>
        <span className="rounded px-1.5 py-0.5 font-mono text-xs" style={{ color: team.color, backgroundColor: `${team.color}25` }}>
          {team.key}
        </span>
        {team.isCUI && <CUIBadge compact />}
        <span className="ml-auto text-xs text-slate-500">
          {projects.length} flagged project{projects.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Risk category count grid */}
      <div className="grid grid-cols-3 gap-px bg-slate-700/20 border-t border-slate-700/20">
        {FLAG_ORDER.map(f => {
          const count    = counts[f] ?? 0;
          const active   = count > 0;
          const selected = openFlag === f;
          return (
            <button
              key={f}
              onClick={() => active && toggleFlag(f)}
              disabled={!active}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 bg-slate-800/40 text-left transition-colors w-full',
                active && !selected && 'hover:bg-slate-700/50 cursor-pointer',
                active && selected && 'bg-slate-700/60',
                !active && 'opacity-30 cursor-default'
              )}
            >
              <span className={cn('shrink-0', active ? FLAG_META[f].row : 'text-slate-600')}>
                {FLAG_META[f].icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-base font-bold tabular-nums leading-none', active ? FLAG_META[f].row : 'text-slate-600')}>
                  {count}
                </span>
                <span className="block text-xs text-slate-500 truncate leading-tight mt-0.5">
                  {FLAG_META[f].label}
                </span>
              </span>
              {active && (
                <ChevronDown className={cn('h-3 w-3 shrink-0 text-slate-500 transition-transform', selected && 'rotate-180')} />
              )}
            </button>
          );
        })}
      </div>

      {/* Drill-down list */}
      {openFlag && <DrillDownList items={projects} flag={openFlag} />}
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


// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttentionPage() {
  const [allItems, setAllItems]             = useState<FlaggedProject[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed]   = useState<Date | null>(null);

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

  const visibleItems = useMemo(
    () => selectedTeamId ? allItems.filter(i => i.team.id === selectedTeamId) : allItems,
    [allItems, selectedTeamId]
  );

  // Group visible items by team, preserving sort order
  const groupedByTeam = useMemo(() => {
    const map = new Map<string, { team: Team; projects: FlaggedProject[] }>();
    for (const item of visibleItems) {
      if (!map.has(item.team.id)) map.set(item.team.id, { team: item.team, projects: [] });
      map.get(item.team.id)!.projects.push(item);
    }
    return [...map.values()];
  }, [visibleItems]);

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
            {loading ? 'Loading…' : selectedTeamId
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
              {/* Hint banner */}
              <div className="flex items-start gap-2.5 rounded-lg border border-blue-900/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-300/80">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400/60" />
                <span>
                  Click any risk category number to expand a list of affected projects with direct links to Linear. Use the <span className="font-semibold text-blue-300">team filter</span> below to focus on a single team.
                </span>
              </div>

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

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {groupedByTeam.map(({ team, projects }) => (
                  <TeamRiskCard key={team.id} team={team} projects={projects} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
