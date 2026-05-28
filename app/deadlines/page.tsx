'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarClock, Flag, Layers, User } from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import { cn, computeCombinedDeadlines, formatDate, formatLeadName, milestoneStatusLabel } from '@/lib/utils';
import { ProgressBar } from '@/components/ProgressBar';
import { RefreshButton } from '@/components/RefreshButton';
import type { CombinedDeadlineItem } from '@/lib/types';

// ── Column definitions ────────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  subtitle: string;
  minDays: number;
  maxDays: number;
  headerClass: string;
  cellBg: string;
}

const BASE_COLUMNS: ColDef[] = [
  { key: 'overdue',    label: 'Overdue',     subtitle: 'Past deadline', minDays: -9999, maxDays: -1,  headerClass: 'text-red-400',    cellBg: 'bg-red-950/10' },
  { key: 'this-week',  label: 'This Week',   subtitle: '0 – 7 days',   minDays: 0,    maxDays: 7,   headerClass: 'text-orange-400', cellBg: 'bg-orange-950/5' },
  { key: 'next-week',  label: 'Next Week',   subtitle: '8 – 14 days',  minDays: 8,    maxDays: 14,  headerClass: 'text-yellow-400', cellBg: 'bg-yellow-950/5' },
  { key: 'this-month', label: 'This Month',  subtitle: '15 – 30 days', minDays: 15,   maxDays: 30,  headerClass: 'text-slate-300',  cellBg: '' },
  { key: 'later',      label: 'Later',       subtitle: '31+ days',     minDays: 31,   maxDays: 9999,headerClass: 'text-slate-500',  cellBg: '' },
];

const WINDOWS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
] as const;

function getColumnKey(days: number): string {
  if (days < 0)  return 'overdue';
  if (days <= 7)  return 'this-week';
  if (days <= 14) return 'next-week';
  if (days <= 30) return 'this-month';
  return 'later';
}

// ── Urgency badge ─────────────────────────────────────────────────────────────

function UrgencyBadge({ days }: { days: number }) {
  const cls =
    days < 0   ? 'bg-red-900/70 text-red-300 border border-red-700' :
    days <= 3  ? 'bg-red-900/60 text-red-300 border border-red-700' :
    days <= 7  ? 'bg-orange-900/60 text-orange-300 border border-orange-700' :
    days <= 14 ? 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/60' :
                 'bg-slate-800/60 text-slate-400 border border-slate-700';
  const label =
    days < 0  ? `${Math.abs(days)}d ago` :
    days === 0 ? 'Today' :
    days === 1 ? '1 day' : `${days}d`;
  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums shrink-0', cls)}>{label}</span>;
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function KanbanCard({ item }: { item: CombinedDeadlineItem }) {
  const isMilestone = item.kind === 'milestone';
  return (
    <div className="rounded-md border border-slate-700/50 bg-slate-800/70 overflow-hidden text-xs hover:border-slate-600/70 transition-colors">
      {/* Team color bar */}
      <div className="h-0.5 w-full" style={{ backgroundColor: item.teamColor }} />
      <div className="p-2.5 flex flex-col gap-2">
        {/* Kind + name */}
        <div className="flex items-start gap-1.5 min-w-0">
          <span className="shrink-0 mt-0.5 text-slate-500">
            {isMilestone ? <Flag className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-200 leading-snug line-clamp-2" title={item.label}>
              {item.label}
            </div>
            {isMilestone && (
              <div className="mt-0.5 text-slate-500 truncate" title={item.projectName}>
                {item.projectName}
              </div>
            )}
          </div>
        </div>

        {/* Lead */}
        {item.lead && (
          <div className="flex items-center gap-1 text-slate-500">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatLeadName(item.lead)}</span>
          </div>
        )}

        {/* Milestone status */}
        {isMilestone && item.milestoneStatus && item.milestoneStatus !== 'done' && (
          <span className="self-start rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 text-slate-400">
            {milestoneStatusLabel(item.milestoneStatus)}
          </span>
        )}

        {/* Progress */}
        <div>
          <ProgressBar progress={item.progress} height="sm" showLabel={false} />
          <div className="mt-0.5 text-right text-slate-600">{Math.round(item.progress * 100)}%</div>
        </div>

        {/* Date + urgency */}
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-slate-700/40">
          <span className="text-slate-500 truncate">{formatDate(item.targetDate)}</span>
          <UrgencyBadge days={item.daysUntil} />
        </div>
      </div>
    </div>
  );
}

// ── Board builder ─────────────────────────────────────────────────────────────

interface TeamRow {
  teamId: string;
  teamName: string;
  teamKey: string;
  teamColor: string;
  cells: Record<string, CombinedDeadlineItem[]>;
}

function buildBoard(items: CombinedDeadlineItem[], cols: ColDef[]): TeamRow[] {
  const rowMap = new Map<string, TeamRow>();

  for (const item of items) {
    if (!rowMap.has(item.teamId)) {
      rowMap.set(item.teamId, {
        teamId:    item.teamId,
        teamName:  item.teamName,
        teamKey:   item.teamName, // will be replaced below
        teamColor: item.teamColor,
        cells:     Object.fromEntries(cols.map(c => [c.key, []])),
      });
    }
    const colKey = getColumnKey(item.daysUntil);
    const row = rowMap.get(item.teamId)!;
    if (row.cells[colKey]) row.cells[colKey].push(item);
  }

  return [...rowMap.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeadlinesPage() {
  const [allItems, setAllItems] = useState<CombinedDeadlineItem[]>([]);
  const [windowDays, setWindowDays] = useState(30);
  const [showMilestones, setShowMilestones] = useState(true);
  const [showProjects, setShowProjects]     = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teams = await fetchPortfolioWithMilestones();
      setAllItems(computeCombinedDeadlines(teams, 90));
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // All unique teams derived from the full data set
  const allTeams = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    for (const item of allItems) {
      if (!seen.has(item.teamId)) seen.set(item.teamId, { id: item.teamId, name: item.teamName, color: item.teamColor });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allItems]);

  const filtered = useMemo(() => allItems.filter(item => {
    if (item.daysUntil > windowDays) return false;
    if (!showMilestones && item.kind === 'milestone') return false;
    if (!showProjects   && item.kind === 'project')   return false;
    if (selectedTeamId && item.teamId !== selectedTeamId) return false;
    return true;
  }), [allItems, windowDays, showMilestones, showProjects, selectedTeamId]);

  // Columns: always show Overdue; hide Later if window <= 30
  const columns = useMemo(() =>
    BASE_COLUMNS.filter(c => c.key !== 'later' || windowDays > 30),
    [windowDays]
  );

  // Column counts (across all teams)
  const colCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of filtered) {
      const k = getColumnKey(item.daysUntil);
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [filtered]);

  const rows = useMemo(() => buildBoard(filtered, columns), [filtered, columns]);

  const projectCount   = filtered.filter(i => i.kind === 'project').length;
  const milestoneCount = filtered.filter(i => i.kind === 'milestone').length;

  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-400" />
            Kanban
          </h1>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${filtered.length} items · ${rows.length} team${rows.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400 shrink-0">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {/* Window */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1">
          {WINDOWS.map(w => (
            <button
              key={w.value}
              onClick={() => setWindowDays(w.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                windowDays === w.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* Kind toggles */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowProjects(v => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              showProjects ? 'border-blue-700 bg-blue-900/40 text-blue-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'
            )}
          >
            <Layers className="h-3 w-3" />Projects
            <span className="tabular-nums">{projectCount}</span>
          </button>
          <button
            onClick={() => setShowMilestones(v => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              showMilestones ? 'border-orange-700 bg-orange-900/40 text-orange-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'
            )}
          >
            <Flag className="h-3 w-3" />Milestones
            <span className="tabular-nums">{milestoneCount}</span>
          </button>
        </div>
      </div>

      {/* Team filter chips */}
      {allTeams.length > 1 && (
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            onClick={() => setSelectedTeamId(null)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              selectedTeamId === null
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
                : 'text-slate-400 border-slate-700 hover:border-slate-500'
            )}
          >
            All Teams
          </button>
          {allTeams.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTeamId(selectedTeamId === t.id ? null : t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                selectedTeamId === t.id ? 'border-current' : 'border-slate-700 text-slate-400 hover:border-slate-500'
              )}
              style={selectedTeamId === t.id
                ? { color: t.color, backgroundColor: `${t.color}18`, borderColor: `${t.color}60` }
                : {}}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">Loading…</div>
      )}
      {!loading && rows.length === 0 && !error && (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">
          No deadlines in the next {windowDays} days.
        </div>
      )}

      {/* Kanban board */}
      {rows.length > 0 && (
        <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 rounded-lg border border-slate-700/50">
          {/* Min-width ensures columns don't collapse */}
          <div style={{ minWidth: `${160 + columns.length * 220}px` }}>

            {/* Column header row */}
            <div
              className="grid sticky top-0 z-20 border-b border-slate-700/50 bg-slate-900"
              style={{ gridTemplateColumns: `160px repeat(${columns.length}, 1fr)` }}
            >
              {/* Team label header */}
              <div className="px-3 py-3 border-r border-slate-700/50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Team
              </div>
              {columns.map(col => (
                <div
                  key={col.key}
                  className={cn('px-3 py-3 border-r border-slate-700/50 last:border-r-0', col.cellBg)}
                >
                  <div className={cn('text-xs font-bold uppercase tracking-wider', col.headerClass)}>
                    {col.label}
                    {(colCounts[col.key] ?? 0) > 0 && (
                      <span className="ml-1.5 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-slate-400 font-semibold normal-case tracking-normal">
                        {colCounts[col.key]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{col.subtitle}</div>
                </div>
              ))}
            </div>

            {/* Team rows */}
            {rows.map((row, rowIdx) => (
              <div
                key={row.teamId}
                className={cn(
                  'grid border-b border-slate-700/30 last:border-b-0',
                  rowIdx % 2 === 1 ? 'bg-slate-800/10' : ''
                )}
                style={{ gridTemplateColumns: `160px repeat(${columns.length}, 1fr)` }}
              >
                {/* Team label */}
                <div className="sticky left-0 z-10 flex flex-col justify-start gap-1 border-r border-slate-700/50 px-3 py-3 bg-slate-900/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: row.teamColor }} />
                    <span className="text-xs font-semibold text-slate-300 leading-tight">{row.teamName}</span>
                  </div>
                  <span
                    className="self-start rounded px-1.5 py-0.5 font-mono text-xs"
                    style={{ color: row.teamColor, backgroundColor: `${row.teamColor}20` }}
                  >
                    {/* show key if different from name — derive from items */}
                    {filtered.find(i => i.teamId === row.teamId) ? '' : ''}
                  </span>
                  <span className="text-xs text-slate-600">
                    {Object.values(row.cells).reduce((n, arr) => n + arr.length, 0)} item{Object.values(row.cells).reduce((n, arr) => n + arr.length, 0) !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Cells */}
                {columns.map(col => {
                  const cards = row.cells[col.key] ?? [];
                  return (
                    <div
                      key={col.key}
                      className={cn(
                        'border-r border-slate-700/30 last:border-r-0 px-2 py-2 align-top',
                        col.cellBg,
                        cards.length === 0 ? 'min-h-[60px]' : ''
                      )}
                    >
                      <div className="flex flex-col gap-2">
                        {cards.map(item => (
                          <KanbanCard key={`${item.kind}-${item.id}`} item={item} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
