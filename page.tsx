'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { ExternalLink, Users, PenLine, ChevronDown, ChevronUp, UserX } from 'lucide-react';
import { RefreshButton } from '@/components/RefreshButton';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkloadUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

interface WorkloadIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  priority: number; // 0=None 1=Urgent 2=High 3=Normal 4=Low
  createdAt: string;
  state: { name: string; type: string };
  assignee: WorkloadUser | null;
  creator: WorkloadUser | null;
  project: { id: string; name: string } | null;
  team: { id: string; name: string; key: string; color: string } | null;
}

interface WorkloadResponse {
  data: {
    issues: {
      nodes: WorkloadIssue[];
    };
  };
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchWorkload(): Promise<WorkloadIssue[]> {
  const res = await fetch('/api/workload', { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }
  const raw = (await res.json()) as WorkloadResponse;
  return raw?.data?.issues?.nodes ?? [];
}

// ── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<number, string> = {
  0: 'No Priority', 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low',
};

const PRIORITY_COLOR: Record<number, string> = {
  0: '#475569', 1: '#dc2626', 2: '#ea580c', 3: '#3b82f6', 4: '#64748b',
};

// Stack order for bars: urgent → high → normal → low → none
const PRIORITY_STACK = [1, 2, 3, 4, 0] as const;

function priorityBreakdown(issues: WorkloadIssue[]): Record<number, number> {
  const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const issue of issues) out[issue.priority] = (out[issue.priority] ?? 0) + 1;
  return out;
}

// ── Derived data types ────────────────────────────────────────────────────────

interface PersonRow {
  userId: string;
  name: string;
  email: string;
  issues: WorkloadIssue[];
  breakdown: Record<number, number>;
}

// ── Bar chart row ─────────────────────────────────────────────────────────────

const BAR_MAX_WIDTH = 340; // px — max bar width

function BarRow({
  row,
  maxCount,
  expanded,
  onToggle,
  teamFilter,
}: {
  row: PersonRow;
  maxCount: number;
  expanded: boolean;
  onToggle: () => void;
  teamFilter: string;
}) {
  const filtered = teamFilter
    ? row.issues.filter((i) => i.team?.id === teamFilter)
    : row.issues;

  const displayCount = filtered.length;
  const displayBreakdown = priorityBreakdown(filtered);
  const barWidth = maxCount > 0 ? (displayCount / maxCount) * BAR_MAX_WIDTH : 0;

  if (displayCount === 0) return null;

  return (
    <div className="border-b border-slate-700/40 last:border-0">
      {/* Main row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
      >
        {/* Name */}
        <div className="w-36 shrink-0">
          <div className="truncate text-sm font-medium text-slate-200">{row.name}</div>
          <div className="truncate text-xs text-slate-600">{row.email.split('@')[0]}</div>
        </div>

        {/* Stacked bar */}
        <div className="flex-1">
          <div
            className="flex h-5 overflow-hidden rounded"
            style={{ width: barWidth, minWidth: displayCount > 0 ? 8 : 0 }}
          >
            {PRIORITY_STACK.map((p) => {
              const count = displayBreakdown[p] ?? 0;
              if (count === 0) return null;
              const segWidth = (count / displayCount) * 100;
              return (
                <div
                  key={p}
                  style={{ width: `${segWidth}%`, backgroundColor: PRIORITY_COLOR[p] }}
                  title={`${PRIORITY_LABEL[p]}: ${count}`}
                />
              );
            })}
          </div>
        </div>

        {/* Count */}
        <div className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-slate-300">
          {displayCount}
        </div>

        {/* Expand toggle */}
        <div className="w-5 shrink-0 text-slate-600">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded issue list */}
      {expanded && (
        <div className="border-t border-slate-700/30 bg-slate-900/40 px-4 pb-3 pt-2">
          <div className="flex flex-col gap-1">
            {filtered.map((issue) => (
              <div key={issue.id} className="flex items-center gap-2">
                {/* Team color dot */}
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: issue.team?.color ?? '#475569' }}
                />
                {/* Identifier */}
                <span className="w-20 shrink-0 font-mono text-xs text-slate-600">
                  {issue.identifier}
                </span>
                {/* Priority pip */}
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PRIORITY_COLOR[issue.priority] }}
                  title={PRIORITY_LABEL[issue.priority]}
                />
                {/* Title + link */}
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-300 hover:text-blue-300 transition-colors"
                >
                  <span className="truncate">{issue.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                </a>
                {/* State */}
                <span className="shrink-0 text-xs text-slate-600">{issue.state.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function PriorityLegend() {
  return (
    <div className="flex items-center gap-4">
      {PRIORITY_STACK.map((p) => (
        <div key={p} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PRIORITY_COLOR[p] }} />
          <span className="text-xs text-slate-500">{PRIORITY_LABEL[p]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Chart section wrapper ─────────────────────────────────────────────────────

function ChartSection({
  title,
  subtitle,
  icon,
  rows,
  maxCount,
  expandedIds,
  onToggle,
  teamFilter,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: PersonRow[];
  maxCount: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  teamFilter: string;
}) {
  const visibleRows = rows.filter((r) => {
    const count = teamFilter
      ? r.issues.filter((i) => i.team?.id === teamFilter).length
      : r.issues.length;
    return count > 0;
  });

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-700/40 px-4 py-3">
        <div className="mt-0.5 text-slate-500">{icon}</div>
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>

      {/* Column labels */}
      <div className="flex items-center gap-3 border-b border-slate-700/30 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-600">
        <span className="w-36 shrink-0">Person</span>
        <span className="flex-1">Issues (by priority)</span>
        <span className="w-10 shrink-0 text-right">Count</span>
        <span className="w-5 shrink-0" />
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-600">No data</div>
      ) : (
        visibleRows.map((row) => (
          <BarRow
            key={row.userId}
            row={row}
            maxCount={maxCount}
            expanded={expandedIds.has(row.userId)}
            onToggle={() => onToggle(row.userId)}
            teamFilter={teamFilter}
          />
        ))
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkloadPage() {
  const [issues, setIssues] = useState<WorkloadIssue[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [teamFilter, setTeamFilter] = useState('');
  const [expandedAssignees, setExpandedAssignees] = useState<Set<string>>(new Set());
  const [expandedCreators, setExpandedCreators] = useState<Set<string>>(new Set());
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const unassignedRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkload();
      setIssues(data);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // All teams for filter dropdown
  const teams = useMemo(() => {
    if (!issues) return [];
    const map = new Map<string, { id: string; name: string; key: string; color: string }>();
    for (const issue of issues) {
      if (issue.team && !map.has(issue.team.id)) map.set(issue.team.id, issue.team);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  // Assignee rows — sorted by issue count desc
  const assigneeRows = useMemo<PersonRow[]>(() => {
    if (!issues) return [];
    const map = new Map<string, PersonRow>();

    for (const issue of issues) {
      if (!issue.assignee) continue;
      const { id, name, email } = issue.assignee;
      if (!map.has(id)) {
        map.set(id, { userId: id, name, email, issues: [], breakdown: {} });
      }
      map.get(id)!.issues.push(issue);
    }

    return [...map.values()]
      .map((r) => ({ ...r, breakdown: priorityBreakdown(r.issues) }))
      .sort((a, b) => b.issues.length - a.issues.length);
  }, [issues]);

  // Creator rows — sorted by issue count desc
  const creatorRows = useMemo<PersonRow[]>(() => {
    if (!issues) return [];
    const map = new Map<string, PersonRow>();

    for (const issue of issues) {
      if (!issue.creator) continue;
      const { id, name, email } = issue.creator;
      if (!map.has(id)) {
        map.set(id, { userId: id, name, email, issues: [], breakdown: {} });
      }
      map.get(id)!.issues.push(issue);
    }

    return [...map.values()]
      .map((r) => ({ ...r, breakdown: priorityBreakdown(r.issues) }))
      .sort((a, b) => b.issues.length - a.issues.length);
  }, [issues]);

  // Max counts for bar scaling (filtered)
  const assigneeMax = useMemo(() => {
    if (!assigneeRows.length) return 1;
    return Math.max(...assigneeRows.map((r) =>
      teamFilter ? r.issues.filter((i) => i.team?.id === teamFilter).length : r.issues.length
    ), 1);
  }, [assigneeRows, teamFilter]);

  const creatorMax = useMemo(() => {
    if (!creatorRows.length) return 1;
    return Math.max(...creatorRows.map((r) =>
      teamFilter ? r.issues.filter((i) => i.team?.id === teamFilter).length : r.issues.length
    ), 1);
  }, [creatorRows, teamFilter]);

  function toggleAssignee(id: string) {
    setExpandedAssignees((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCreator(id: string) {
    setExpandedCreators((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Summary stats
  const totalIssues  = issues?.length ?? 0;
  const unassigned   = issues?.filter((i) => !i.assignee).length ?? 0;
  const urgentCount  = issues?.filter((i) => i.priority === 1).length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-white">Workload</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Open issue distribution across the team
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary chips */}
      {issues && (
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
            <div className="text-xl font-bold tabular-nums text-slate-200">{totalIssues}</div>
            <div className="text-xs text-slate-600">Open issues</div>
          </div>
          {/* Unassigned chip — clickable to jump & expand */}
          <button
            onClick={() => {
              if (unassigned === 0) return;
              setUnassignedExpanded(true);
              setTimeout(() => unassignedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }}
            disabled={unassigned === 0}
            className={cn(
              'rounded-lg border px-4 py-2.5 text-center transition-colors',
              unassigned > 0
                ? 'border-yellow-800/60 bg-yellow-950/20 hover:bg-yellow-950/40 cursor-pointer'
                : 'border-slate-700/50 bg-slate-800/40 cursor-default'
            )}
          >
            <div className={cn('text-xl font-bold tabular-nums', unassigned > 0 ? 'text-yellow-400' : 'text-slate-200')}>
              {unassigned}
            </div>
            <div className="text-xs text-slate-600">Unassigned ↓</div>
          </button>
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
            <div className={cn('text-xl font-bold tabular-nums', urgentCount > 0 ? 'text-red-400' : 'text-slate-200')}>{urgentCount}</div>
            <div className="text-xs text-slate-600">Urgent</div>
          </div>
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
            <div className="text-xl font-bold tabular-nums text-slate-200">{assigneeRows.length}</div>
            <div className="text-xs text-slate-600">Contributors</div>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 shrink-0">Filter by team:</span>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTeamFilter('')}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              teamFilter === ''
                ? 'bg-blue-600/30 text-blue-300 border border-blue-600/50'
                : 'text-slate-400 border border-slate-700 hover:bg-slate-800'
            )}
          >
            All teams
          </button>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setTeamFilter(t.id === teamFilter ? '' : t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors border',
                teamFilter === t.id
                  ? 'text-white'
                  : 'text-slate-400 border-slate-700 hover:bg-slate-800'
              )}
              style={
                teamFilter === t.id
                  ? { backgroundColor: `${t.color}30`, borderColor: `${t.color}60`, color: t.color }
                  : {}
              }
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: t.color }}
              />
              {t.key}
            </button>
          ))}
        </div>
      </div>

      {/* Priority legend */}
      {issues && <PriorityLegend />}

      {loading && (
        <div className="py-16 text-center text-sm text-slate-600">Loading workload data…</div>
      )}

      {/* Charts */}
      {issues && !loading && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

          {/* Assignee chart */}
          <ChartSection
            title="Task Load by Assignee"
            subtitle="Who has the most open issues assigned to them"
            icon={<Users className="h-4 w-4" />}
            rows={assigneeRows}
            maxCount={assigneeMax}
            expandedIds={expandedAssignees}
            onToggle={toggleAssignee}
            teamFilter={teamFilter}
          />

          {/* Creator chart */}
          <ChartSection
            title="Issues Created by Person"
            subtitle="Who is actively logging tasks in Linear"
            icon={<PenLine className="h-4 w-4" />}
            rows={creatorRows}
            maxCount={creatorMax}
            expandedIds={expandedCreators}
            onToggle={toggleCreator}
            teamFilter={teamFilter}
          />

        </div>
      )}

      {/* Unassigned drilldown */}
      {issues && unassigned > 0 && (
        <div ref={unassignedRef} className="rounded-lg border border-yellow-800/50 bg-yellow-950/20">
          {/* Header — always visible, toggles expansion */}
          <button
            onClick={() => setUnassignedExpanded((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-yellow-950/30"
          >
            <UserX className="h-4 w-4 shrink-0 text-yellow-500" />
            <div className="flex-1">
              <span className="text-sm font-semibold text-yellow-400">
                {unassigned} unassigned issue{unassigned !== 1 ? 's' : ''}
              </span>
              <span className="ml-2 text-xs text-slate-500">
                not reflected in the assignee chart above
              </span>
            </div>
            <div className="text-yellow-700">
              {unassignedExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </button>

          {/* Expanded issue list */}
          {unassignedExpanded && (() => {
            const unassignedIssues = (teamFilter
              ? issues.filter((i) => !i.assignee && i.team?.id === teamFilter)
              : issues.filter((i) => !i.assignee)
            ).sort((a, b) => a.priority - b.priority || a.identifier.localeCompare(b.identifier));

            return (
              <div className="border-t border-yellow-800/40 px-4 pb-3 pt-2">
                {unassignedIssues.length === 0 ? (
                  <p className="py-2 text-xs text-slate-500">No unassigned issues for the selected team.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {unassignedIssues.map((issue) => (
                      <div key={issue.id} className="flex items-center gap-2">
                        {/* Team color dot */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: issue.team?.color ?? '#475569' }}
                        />
                        {/* Team key */}
                        <span className="w-12 shrink-0 font-mono text-xs text-slate-600">
                          {issue.team?.key ?? '—'}
                        </span>
                        {/* Identifier */}
                        <span className="w-20 shrink-0 font-mono text-xs text-slate-500">
                          {issue.identifier}
                        </span>
                        {/* Priority pip */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: PRIORITY_COLOR[issue.priority] }}
                          title={PRIORITY_LABEL[issue.priority]}
                        />
                        {/* Title + link */}
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-300 hover:text-blue-300 transition-colors"
                        >
                          <span className="truncate">{issue.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </a>
                        {/* Project */}
                        <span className="shrink-0 text-xs text-slate-600 truncate max-w-32">
                          {issue.project?.name ?? '—'}
                        </span>
                        {/* State */}
                        <span className="shrink-0 text-xs text-slate-600">{issue.state.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}
