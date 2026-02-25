'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, MessageSquare, User, CalendarRange, Flag, ExternalLink, AlertCircle } from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import { cn, formatDate, formatLeadName, isAtRisk, isOverdue, milestoneStatusClasses, milestoneStatusLabel, daysUntil, healthClasses, healthLabel } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { ProgressBar } from '@/components/ProgressBar';
import { CUIBadge } from '@/components/CUIBadge';
import { RefreshButton } from '@/components/RefreshButton';
import type { Team, Project, Milestone } from '@/lib/types';

function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return null;
  // Sort by targetDate ascending (null dates last), then sortOrder
  const sorted = [...milestones].sort((a, b) => {
    if (!a.targetDate && !b.targetDate) return a.sortOrder - b.sortOrder;
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    return a.targetDate.localeCompare(b.targetDate);
  });
  return (
    <div className="border-t border-slate-700/30">
      <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
        <Flag className="h-3 w-3" /> Milestones ({milestones.length})
      </div>
      <ul className="divide-y divide-slate-700/20">
        {sorted.map((ms) => {
          const days = ms.targetDate ? daysUntil(ms.targetDate) : null;
          const isOverdueMs = ms.status === 'overdue' || (days !== null && days < 0 && ms.status !== 'done');
          return (
            <li key={ms.id} className="flex items-center gap-3 px-3 py-2">
              <Flag className={cn('h-3 w-3 shrink-0', ms.status === 'done' ? 'text-green-500' : isOverdueMs ? 'text-red-400' : 'text-slate-600')} />
              <span className={cn('flex-1 truncate text-sm', ms.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300')}>
                {ms.name}
              </span>
              {ms.targetDate && (
                <span className={cn('shrink-0 text-xs', isOverdueMs ? 'text-red-400' : 'text-slate-500')}>
                  {formatDate(ms.targetDate)}
                  {days !== null && days >= 0 && days <= 30 && (
                    <span className="ml-1 text-slate-600">({days}d)</span>
                  )}
                </span>
              )}
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', milestoneStatusClasses(ms.status))}>
                {milestoneStatusLabel(ms.status)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IssueList({ project }: { project: Project }) {
  const issues = project.issues.nodes;
  if (issues.length === 0) {
    return <div className="px-3 py-2 text-xs text-slate-600">No issues.</div>;
  }
  return (
    <ul className="divide-y divide-slate-700/30">
      {issues.map((issue) => (
        <li key={issue.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
          <PriorityBadge priority={issue.priority} showLabel={false} />
          <span className="shrink-0 font-mono text-xs text-slate-600">{issue.identifier}</span>
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 min-w-0 items-center gap-1 truncate text-slate-300 hover:text-blue-300 transition-colors"
            title="Open in Linear"
          >
            <span className="truncate">{issue.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
          </a>
          <StatusBadge
            state={issue.state.type === 'started' ? 'started' : 'planned'}
            overrideLabel={issue.state.name}
          />
        </li>
      ))}
    </ul>
  );
}

function healthStaleDays(healthUpdatedAt: string | null): number | null {
  if (!healthUpdatedAt) return null;
  const updated = new Date(healthUpdatedAt);
  const now = new Date();
  return Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
}

function ProjectCard({ project, teamColor }: { project: Project; teamColor: string }) {
  const atRisk = isAtRisk(project);
  const overdue = isOverdue(project);
  const staleDays = healthStaleDays(project.healthUpdatedAt);
  const isStale = staleDays !== null && staleDays > 14;

  return (
    <div className="rounded-lg border bg-slate-800/40" style={{ borderColor: `${teamColor}30` }}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Project name links to Linear */}
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-blue-300 transition-colors"
              title="Open in Linear"
            >
              {project.name}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
            {overdue && (
              <StatusBadge state="cancelled" overrideLabel="Overdue"
                className="border-red-700 bg-red-950/50 text-red-400" />
            )}
            {atRisk && !overdue && (
              <StatusBadge state="started" overrideLabel="At Risk"
                className="border-orange-700 bg-orange-950/50 text-orange-400" />
            )}
            {!overdue && !atRisk && <StatusBadge state={project.state} />}
            {/* PM health badge */}
            {project.health && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', healthClasses(project.health))}>
                {healthLabel(project.health)}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
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
            {/* Health staleness warning */}
            {project.health && isStale && (
              <span className="flex items-center gap-1 text-yellow-600" title={`PM health last updated ${staleDays} days ago`}>
                <AlertCircle className="h-3 w-3" />
                Health stale ({staleDays}d)
              </span>
            )}
            {/* Prompt if health never set */}
            {!project.health && project.state === 'started' && (
              <span className="flex items-center gap-1 text-slate-600" title="No PM health status set in Linear">
                <AlertCircle className="h-3 w-3" />
                No health status
              </span>
            )}
          </div>
        </div>
        <div className="w-48 shrink-0">
          <ProgressBar progress={project.progress} />
        </div>
      </div>
      <MilestoneList milestones={project.projectMilestones?.nodes ?? []} />
      <div className="border-t border-slate-700/30">
        <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-slate-600">
          Issues ({project.issues.nodes.length})
        </div>
        <IssueList project={project} />
      </div>
    </div>
  );
}

function PlaceholderSection({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700/50 py-10 text-sm text-slate-700">
      {icon}{label} — coming soon
    </div>
  );
}

export default function ProgramDetailPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teams = await fetchPortfolioWithMilestones();
      const found = teams.find((t) => t.id === teamId) ?? null;
      setTeam(found);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !team) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-500">
        Loading program data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">{error}</div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-8 text-center text-sm text-slate-500">
          Team not found.
        </div>
      </div>
    );
  }

  const activeProjects = team.projects.nodes.filter(
    (p) => p.state !== 'completed' && p.state !== 'cancelled'
  );
  const completedProjects = team.projects.nodes.filter((p) => p.state === 'completed');

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" />Portfolio Overview
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: team.color }} />
            <h1 className="text-xl font-bold text-white">{team.name}</h1>
            <span className="rounded px-1.5 py-0.5 font-mono text-sm font-medium"
              style={{ color: team.color, backgroundColor: `${team.color}20` }}>
              {team.key}
            </span>
            {team.isCUI && <CUIBadge />}
          </div>
          <div className="ml-auto">
            <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Active Projects ({activeProjects.length})
        </h2>
        {activeProjects.length === 0 ? (
          <div className="rounded-lg border border-slate-700/50 px-4 py-8 text-center text-sm text-slate-600">
            No active projects.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {activeProjects.map((project: Project) => (
              <ProjectCard key={project.id} project={project} teamColor={team.color} />
            ))}
          </div>
        )}
      </section>

      {completedProjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Completed ({completedProjects.length})
          </h2>
          <div className="flex flex-col gap-3">
            {completedProjects.map((project: Project) => (
              <div key={project.id}
                className="flex items-center gap-3 rounded-lg border border-slate-700/30 bg-slate-800/20 px-4 py-2.5 opacity-60">
                <StatusBadge state="completed" />
                <span className="flex-1 truncate text-sm text-slate-400 line-through">{project.name}</span>
                <ProgressBar progress={1} showLabel={false} className="w-24" />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Schedule</h2>
        <PlaceholderSection icon={<Calendar className="h-4 w-4" />} label="Calendar integration" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Communications</h2>
        <PlaceholderSection icon={<MessageSquare className="h-4 w-4" />} label="Slack / Teams integration" />
      </section>
    </div>
  );
}
