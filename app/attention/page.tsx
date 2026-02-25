'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  ChevronRight,
  User,
  CalendarRange,
  CheckCircle2,
  TrendingDown,
  ExternalLink,
} from 'lucide-react';
import { fetchPortfolio } from '@/lib/api';
import {
  cn,
  isAtRisk,
  isOverdue,
  daysUntil,
  formatDate,
  formatLeadName,
  healthClasses,
  healthLabel,
} from '@/lib/utils';
import { ProgressBar } from '@/components/ProgressBar';
import { StatusBadge } from '@/components/StatusBadge';
import { CUIBadge } from '@/components/CUIBadge';
import { RefreshButton } from '@/components/RefreshButton';
import type { Team, Project } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlaggedProject {
  project: Project;
  team: Team;
  overdueBy: number | null; // negative = overdue, null = not overdue
  daysLeft: number | null;  // null when no targetDate
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectFlagged(teams: Team[]): {
  overdue: FlaggedProject[];
  atRisk: FlaggedProject[];
} {
  const overdue: FlaggedProject[] = [];
  const atRisk: FlaggedProject[] = [];

  for (const team of teams) {
    for (const project of team.projects.nodes) {
      if (project.state === 'completed' || project.state === 'cancelled') continue;

      const days = project.targetDate ? daysUntil(project.targetDate) : null;

      if (isOverdue(project)) {
        overdue.push({ project, team, overdueBy: days, daysLeft: days });
      } else if (isAtRisk(project)) {
        atRisk.push({ project, team, overdueBy: null, daysLeft: days });
      }
    }
  }

  // Sort overdue: most overdue first (most negative days first)
  overdue.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  // Sort at-risk: soonest deadline first
  atRisk.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  return { overdue, atRisk };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count,
  accentClass,
  bgClass,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  accentClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', bgClass)}>
        {icon}
      </div>
      <h2 className={cn('text-sm font-bold uppercase tracking-wider', accentClass)}>
        {label}
      </h2>
      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums', bgClass, accentClass)}>
        {count}
      </span>
    </div>
  );
}

function AttentionCard({ item, variant }: { item: FlaggedProject; variant: 'overdue' | 'at-risk' }) {
  const { project, team } = item;
  const overdue = variant === 'overdue';

  const overdueLabel =
    item.daysLeft === null
      ? 'No target date'
      : item.daysLeft === 0
      ? 'Due today'
      : `${Math.abs(item.daysLeft)}d overdue`;

  const atRiskLabel =
    item.daysLeft === null
      ? 'No target date'
      : item.daysLeft === 0
      ? 'Due today'
      : item.daysLeft === 1
      ? 'Due tomorrow'
      : `${item.daysLeft}d left`;

  const timeLabel = overdue ? overdueLabel : atRiskLabel;

  const timeLabelClass = overdue
    ? 'text-red-400 font-semibold'
    : item.daysLeft !== null && item.daysLeft <= 7
    ? 'text-orange-400 font-semibold'
    : 'text-yellow-400 font-medium';

  const borderColor = overdue ? '#ef444440' : '#f9731640';
  const headerBg = overdue ? 'bg-red-950/30' : 'bg-orange-950/20';

  return (
    <div
      className="rounded-lg border bg-slate-800/40 transition-shadow hover:shadow-md"
      style={{ borderColor }}
    >
      {/* Card header */}
      <div className={cn('flex items-center gap-3 rounded-t-lg px-4 py-3', headerBg)}>
        {/* Team color dot + name */}
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: team.color }}
        />
        <Link
          href={`/programs/${team.id}`}
          className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          {team.name}
          <span
            className="ml-1.5 rounded px-1 py-0.5 font-mono text-xs"
            style={{ color: team.color, backgroundColor: `${team.color}20` }}
          >
            {team.key}
          </span>
        </Link>
        {team.isCUI && <CUIBadge compact />}
        <span className={cn('ml-auto text-sm', timeLabelClass)}>{timeLabel}</span>
      </div>

      {/* Card body */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Project name + status */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-blue-300 transition-colors leading-snug"
              title="Open in Linear"
            >
              {project.name}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {project.lead && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />{formatLeadName(project.lead.name)}
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
                  <CalendarRange className="h-3 w-3" />
                  Target: {formatDate(project.targetDate)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge
              state={project.state}
              overrideLabel={overdue ? 'Overdue' : 'At Risk'}
              className={cn(
                overdue
                  ? 'border-red-700 bg-red-950/50 text-red-400'
                  : 'border-orange-700 bg-orange-950/50 text-orange-400'
              )}
            />
            {project.health && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', healthClasses(project.health))}>
                PM: {healthLabel(project.health)}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-end text-xs">
            <span className={project.progress < 0.25 ? 'text-red-400' : 'text-slate-500'}>
              {Math.round(project.progress * 100)}% complete
            </span>
          </div>
          <ProgressBar progress={project.progress} height="md" showLabel={false} />
        </div>

        {/* Issues (if any) */}
        {project.issues.nodes.length > 0 && (
          <div className="border-t border-slate-700/40 pt-2">
            <div className="mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
              Open Issues ({project.issues.nodes.length})
            </div>
            <ul className="space-y-1">
              {project.issues.nodes.slice(0, 3).map((issue) => (
                <li key={issue.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-600 shrink-0" />
                  <span className="truncate">{issue.title}</span>
                  <span className="shrink-0 text-slate-600">{issue.state.name}</span>
                </li>
              ))}
              {project.issues.nodes.length > 3 && (
                <li className="text-xs text-slate-600 pl-3.5">
                  +{project.issues.nodes.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Link to program detail */}
        <Link
          href={`/programs/${team.id}`}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors self-end"
        >
          View program <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AllClearBanner() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-green-800/40 bg-green-950/20 py-16">
      <CheckCircle2 className="h-12 w-12 text-green-500/60" />
      <div className="text-center">
        <div className="text-lg font-semibold text-green-400">All clear</div>
        <div className="mt-1 text-sm text-slate-500">
          No overdue or at-risk projects right now.
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttentionPage() {
  const [overdue, setOverdue] = useState<FlaggedProject[]>([]);
  const [atRisk, setAtRisk] = useState<FlaggedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teams = await fetchPortfolio();
      const { overdue: ov, atRisk: ar } = collectFlagged(teams);
      setOverdue(ov);
      setAtRisk(ar);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalFlagged = overdue.length + atRisk.length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-400" />
            Needs Attention
          </h1>
          <p className="text-sm text-slate-500">
            Overdue and at-risk SBIR programs · Leadership view
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error loading data:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && totalFlagged === 0 && (
        <div className="flex items-center justify-center py-24">
          <div className="text-sm text-slate-500">Loading…</div>
        </div>
      )}

      {/* Content */}
      {(!loading || totalFlagged > 0) && !error && (
        <>
          {totalFlagged === 0 ? (
            <AllClearBanner />
          ) : (
            <>
              {/* Summary strip */}
              <div className="flex flex-wrap gap-3">
                {overdue.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-2.5">
                    <Clock className="h-4 w-4 text-red-400" />
                    <span className="text-sm font-semibold text-red-400 tabular-nums">
                      {overdue.length}
                    </span>
                    <span className="text-sm text-red-400/70">
                      {overdue.length === 1 ? 'program overdue' : 'programs overdue'}
                    </span>
                  </div>
                )}
                {atRisk.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-orange-800/50 bg-orange-950/30 px-4 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-orange-400" />
                    <span className="text-sm font-semibold text-orange-400 tabular-nums">
                      {atRisk.length}
                    </span>
                    <span className="text-sm text-orange-400/70">
                      {atRisk.length === 1 ? 'program at risk' : 'programs at risk'}
                    </span>
                  </div>
                )}
              </div>

              {/* Overdue section */}
              {overdue.length > 0 && (
                <section>
                  <SectionHeader
                    icon={<Clock className="h-4 w-4 text-red-400" />}
                    label="Overdue"
                    count={overdue.length}
                    accentClass="text-red-400"
                    bgClass="bg-red-900/40"
                  />
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {overdue.map((item) => (
                      <AttentionCard
                        key={item.project.id}
                        item={item}
                        variant="overdue"
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* At Risk section */}
              {atRisk.length > 0 && (
                <section>
                  <SectionHeader
                    icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
                    label="At Risk"
                    count={atRisk.length}
                    accentClass="text-orange-400"
                    bgClass="bg-orange-900/40"
                  />
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {atRisk.map((item) => (
                      <AttentionCard
                        key={item.project.id}
                        item={item}
                        variant="at-risk"
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
