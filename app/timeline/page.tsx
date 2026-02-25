'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  GanttChart,
  Flag,
  Layers,
  Clock,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  ExternalLink,
} from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import {
  cn,
  daysUntil,
  formatDate,
  formatLeadName,
  isOverdue,
  milestoneStatusClasses,
  healthClasses,
  healthLabel,
} from '@/lib/utils';
import { RefreshButton } from '@/components/RefreshButton';
import { ProgressBar } from '@/components/ProgressBar';
import type { Team, Project, Milestone, MilestoneStatus, ProjectHealth } from '@/lib/types';

// ── Horizon bucket definitions ─────────────────────────────────────────────────

type BucketKey = 'overdue' | 'week' | 'nextweek' | 'month' | 'beyond';

interface Bucket {
  key:       BucketKey;
  label:     string;
  sublabel:  string;
  icon:      React.ReactNode;
  headerCls: string;
  borderCls: string;
  countCls:  string;
}

const BUCKETS: Bucket[] = [
  {
    key:       'overdue',
    label:     'Overdue',
    sublabel:  'Past due date',
    icon:      <Clock className="h-4 w-4" />,
    headerCls: 'text-red-400',
    borderCls: 'border-red-900/60',
    countCls:  'bg-red-900/60 border-red-700 text-red-300',
  },
  {
    key:       'week',
    label:     'This Week',
    sublabel:  'Due in 0 – 7 days',
    icon:      <CalendarCheck className="h-4 w-4" />,
    headerCls: 'text-orange-400',
    borderCls: 'border-orange-900/40',
    countCls:  'bg-orange-900/50 border-orange-700 text-orange-300',
  },
  {
    key:       'nextweek',
    label:     'Next Week',
    sublabel:  'Due in 8 – 14 days',
    icon:      <CalendarClock className="h-4 w-4" />,
    headerCls: 'text-yellow-400',
    borderCls: 'border-yellow-900/30',
    countCls:  'bg-yellow-900/40 border-yellow-700 text-yellow-300',
  },
  {
    key:       'month',
    label:     'Next 30 Days',
    sublabel:  'Due in 15 – 30 days',
    icon:      <CalendarRange className="h-4 w-4" />,
    headerCls: 'text-blue-400',
    borderCls: 'border-blue-900/30',
    countCls:  'bg-blue-900/40 border-blue-700 text-blue-300',
  },
  {
    key:       'beyond',
    label:     'Beyond 30 Days',
    sublabel:  'Due after 30 days',
    icon:      <CalendarRange className="h-4 w-4" />,
    headerCls: 'text-slate-400',
    borderCls: 'border-slate-700/50',
    countCls:  'bg-slate-800 border-slate-600 text-slate-400',
  },
];

// ── Item classification ────────────────────────────────────────────────────────

function getBucket(days: number, itemIsOverdue: boolean): BucketKey {
  if (itemIsOverdue || days < 0) return 'overdue';
  if (days <= 7)  return 'week';
  if (days <= 14) return 'nextweek';
  if (days <= 30) return 'month';
  return 'beyond';
}

// ── Horizon item type ──────────────────────────────────────────────────────────

interface HorizonItem {
  kind:            'project' | 'milestone';
  id:              string;
  label:           string;
  sublabel:        string;          // project name (for milestones) or team name (for projects)
  teamId:          string;
  teamName:        string;
  teamColor:       string;
  linearUrl?:      string;          // direct Linear URL (projects only)
  health?:         ProjectHealth | null;
  targetDate:      string | null;
  daysUntil:       number;
  progress:        number;
  lead:            string | null;   // formatted display name
  milestoneStatus?: MilestoneStatus;
  projectState?:   string;
  bucket:          BucketKey;
  isOverdue:       boolean;
}

// ── Data derivation ────────────────────────────────────────────────────────────

function buildHorizonItems(teams: Team[]): HorizonItem[] {
  const items: HorizonItem[] = [];

  for (const team of teams) {
    for (const project of team.projects.nodes) {
      const isActive = project.state !== 'completed' && project.state !== 'cancelled';
      if (!isActive) continue;

      // Project deadline card
      if (project.targetDate) {
        const days    = daysUntil(project.targetDate);
        const overdue = isOverdue(project);
        items.push({
          kind:         'project',
          id:           project.id,
          label:        project.name,
          sublabel:     team.name,
          teamId:       team.id,
          teamName:     team.name,
          teamColor:    team.color,
          linearUrl:    project.url,
          health:       project.health,
          targetDate:   project.targetDate,
          daysUntil:    days,
          progress:     project.progress,
          lead:         project.lead ? formatLeadName(project.lead.name) : null,
          projectState: project.state,
          bucket:       getBucket(days, overdue),
          isOverdue:    overdue,
        });
      }

      // Milestone cards
      for (const ms of (project.projectMilestones?.nodes ?? [])) {
        if (ms.status === 'done') continue;
        if (!ms.targetDate) continue;
        const days    = daysUntil(ms.targetDate);
        const overdue = ms.status === 'overdue' || days < 0;
        items.push({
          kind:            'milestone',
          id:              ms.id,
          label:           ms.name,
          sublabel:        project.name,
          teamId:          team.id,
          teamName:        team.name,
          teamColor:       team.color,
          targetDate:      ms.targetDate,
          daysUntil:       days,
          progress:        ms.progress,
          lead:            null,
          milestoneStatus: ms.status,
          bucket:          getBucket(days, overdue),
          isOverdue:       overdue,
        });
      }
    }
  }

  // Sort each group: most urgent first (lowest daysUntil)
  return items.sort((a, b) => a.daysUntil - b.daysUntil);
}

// ── Horizon card ──────────────────────────────────────────────────────────────

function urgencyDateClass(days: number, overdue: boolean): string {
  if (overdue || days < 0)  return 'text-red-400 font-semibold';
  if (days === 0)            return 'text-red-400 font-semibold';
  if (days <= 3)             return 'text-orange-400 font-medium';
  if (days <= 7)             return 'text-orange-300';
  return 'text-slate-400';
}

function dayLabel(days: number, overdue: boolean): string {
  if (overdue && days < 0)  return `${Math.abs(days)}d overdue`;
  if (days === 0)            return 'Due today';
  if (days === 1)            return 'Tomorrow';
  return `${days}d`;
}

function HorizonCard({ item }: { item: HorizonItem }) {
  const isMilestone = item.kind === 'milestone';

  return (
    <Link
      href={`/programs/${item.teamId}`}
      className="group block rounded-lg border bg-slate-800/40 transition-all hover:bg-slate-800/70 hover:shadow-md"
      style={{ borderColor: `${item.teamColor}35` }}
    >
      {/* Top accent bar */}
      <div
        className="h-0.5 rounded-t-lg"
        style={{ backgroundColor: item.isOverdue ? '#ef4444' : item.teamColor }}
      />

      <div className="px-3 py-2.5">
        {/* Header row: kind icon + label + day badge */}
        <div className="flex items-start gap-2">
          <div
            className="mt-0.5 shrink-0"
            style={{ color: item.isOverdue ? '#ef4444' : item.teamColor }}
          >
            {isMilestone
              ? <Flag className="h-3.5 w-3.5" />
              : <Layers className="h-3.5 w-3.5" />
            }
          </div>

          <div className="flex-1 min-w-0">
            {/* Label — links to Linear for projects */}
            {item.linearUrl ? (
              <a
                href={item.linearUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="group/link inline-flex items-center gap-1 text-xs font-semibold text-slate-200 hover:text-blue-300 transition-colors leading-tight"
                title="Open in Linear"
              >
                <span className="truncate">{item.label}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover/link:opacity-60 transition-opacity" />
              </a>
            ) : (
              <div className="text-xs font-semibold text-slate-200 leading-tight truncate">
                {item.label}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              {/* Team pill */}
              <span
                className="rounded px-1.5 py-0.5 font-mono text-xs"
                style={{ color: item.teamColor, backgroundColor: `${item.teamColor}20` }}
              >
                {item.teamName}
              </span>
              {/* For milestones: show parent project */}
              {isMilestone && (
                <span className="text-xs text-slate-600 truncate">{item.sublabel}</span>
              )}
              {/* PM health badge for projects */}
              {!isMilestone && item.health && (
                <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', healthClasses(item.health))}>
                  {healthLabel(item.health)}
                </span>
              )}
            </div>
          </div>

          {/* Day badge */}
          <div className="shrink-0 text-right">
            <div className={cn('text-xs tabular-nums', urgencyDateClass(item.daysUntil, item.isOverdue))}>
              {dayLabel(item.daysUntil, item.isOverdue)}
            </div>
            {item.targetDate && (
              <div className="text-xs text-slate-600 mt-0.5">
                {formatDate(item.targetDate)}
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2">
          <ProgressBar progress={item.progress} height="sm" showLabel={false} />
          <div className="mt-0.5 flex justify-between text-xs text-slate-600">
            <span>{item.lead ?? (isMilestone ? item.milestoneStatus : '')}</span>
            <span>{Math.round(item.progress * 100)}%</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

function HorizonColumn({
  bucket,
  items,
  showBeyond,
}: {
  bucket:      Bucket;
  items:       HorizonItem[];
  showBeyond:  boolean;
}) {
  if (bucket.key === 'beyond' && !showBeyond) return null;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Column header */}
      <div className={cn('flex items-center gap-2 pb-2 border-b', bucket.borderCls)}>
        <span className={bucket.headerCls}>{bucket.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-semibold', bucket.headerCls)}>
            {bucket.label}
          </div>
          <div className="text-xs text-slate-600">{bucket.sublabel}</div>
        </div>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums', bucket.countCls)}>
          {items.length}
        </span>
      </div>

      {/* Cards */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-700/30 bg-slate-800/10 px-3 py-6 text-center text-xs text-slate-700">
          Nothing here
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(item => (
            <HorizonCard key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type FilterKind = 'all' | 'projects' | 'milestones';

export default function TimelinePage() {
  const [teams,         setTeams]         = useState<Team[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filter,        setFilter]        = useState<FilterKind>('all');
  const [showBeyond,    setShowBeyond]    = useState(false);

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

  const allItems = useMemo(() => buildHorizonItems(teams), [teams]);

  const filteredItems = useMemo(() => {
    if (filter === 'projects')  return allItems.filter(i => i.kind === 'project');
    if (filter === 'milestones') return allItems.filter(i => i.kind === 'milestone');
    return allItems;
  }, [allItems, filter]);

  const byBucket = useMemo(() => {
    const map: Record<BucketKey, HorizonItem[]> = {
      overdue: [], week: [], nextweek: [], month: [], beyond: [],
    };
    for (const item of filteredItems) map[item.bucket].push(item);
    return map;
  }, [filteredItems]);

  const totalVisible = filteredItems.filter(i =>
    i.bucket !== 'beyond' || showBeyond
  ).length;

  const FILTERS: { key: FilterKind; label: string }[] = [
    { key: 'all',        label: 'All' },
    { key: 'projects',   label: 'Projects only' },
    { key: 'milestones', label: 'Milestones only' },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <GanttChart className="h-5 w-5 text-blue-400" />
            Timeline
          </h1>
          <p className="text-sm text-slate-500">
            Deadline horizon · {totalVisible} item{totalVisible !== 1 ? 's' : ''}
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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Kind filter */}
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

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-slate-600 ml-1">
          <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Project</span>
          <span className="flex items-center gap-1"><Flag className="h-3 w-3" /> Milestone</span>
        </div>

        {/* Beyond 30d toggle */}
        <button
          onClick={() => setShowBeyond(v => !v)}
          className={cn(
            'ml-auto rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
            showBeyond
              ? 'border-slate-600 bg-slate-700 text-slate-200'
              : 'border-slate-700 text-slate-500 hover:text-slate-300'
          )}
        >
          {showBeyond ? 'Hide beyond 30d' : `Show beyond 30d (${byBucket.beyond.length})`}
        </button>
      </div>

      {/* Loading */}
      {loading && teams.length === 0 && (
        <div className="flex items-center justify-center py-24 text-sm text-slate-500">
          Loading timeline…
        </div>
      )}

      {/* Horizon columns */}
      {teams.length > 0 && (
        <div className={cn(
          'grid gap-4',
          showBeyond ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
        )}>
          {BUCKETS.map(bucket => (
            <HorizonColumn
              key={bucket.key}
              bucket={bucket}
              items={byBucket[bucket.key]}
              showBeyond={showBeyond}
            />
          ))}
        </div>
      )}
    </div>
  );
}
