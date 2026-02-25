'use client';

import Link from 'next/link';
import { ChevronRight, Layers, ExternalLink } from 'lucide-react';
import { cn, isAtRisk, isOverdue, statusLabel, formatLeadName, formatDate, daysUntil, healthClasses, healthLabel } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { ProgressBar } from './ProgressBar';
import { CUIBadge } from './CUIBadge';
import type { Team, Project } from '@/lib/types';

function dateUrgencyClass(project: Project): string {
  if (!project.targetDate) return 'text-slate-500';
  if (isOverdue(project)) return 'text-red-400 font-medium';
  const days = daysUntil(project.targetDate);
  if (days <= 7)  return 'text-orange-400 font-medium';
  if (days <= 14) return 'text-yellow-400';
  return 'text-slate-500';
}

function ProjectRow({ project }: { project: Project }) {
  const atRisk = isAtRisk(project);
  const overdue = isOverdue(project);

  return (
    <div className="group flex items-center gap-3 py-2.5">
      <StatusBadge
        state={project.state}
        overrideLabel={
          overdue ? 'Overdue' : atRisk ? 'At Risk' : statusLabel(project.state)
        }
        className={cn(
          'w-24 shrink-0 justify-center',
          overdue && 'border-red-700 bg-red-950/50 text-red-400',
          atRisk && !overdue && 'border-orange-700 bg-orange-950/50 text-orange-400'
        )}
      />
      {/* Project name — links to Linear */}
      <a
        href={project.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 flex items-center gap-1 truncate text-sm text-slate-200 hover:text-blue-300 transition-colors"
        title={`Open in Linear: ${project.name}`}
      >
        <span className="truncate">{project.name}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
      </a>
      {/* PM health badge */}
      {project.health && (
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium', healthClasses(project.health))}>
          {healthLabel(project.health)}
        </span>
      )}
      <div className="w-32 shrink-0">
        <ProgressBar progress={project.progress} height="sm" showLabel={false} />
        <div className="mt-0.5 text-right text-xs text-slate-600">
          {Math.round(project.progress * 100)}%
        </div>
      </div>
      {/* Date + lead stacked */}
      <div className="w-32 shrink-0 text-right">
        <div className={cn('text-xs truncate', dateUrgencyClass(project))}>
          {project.targetDate ? formatDate(project.targetDate) : '—'}
        </div>
        <div className="text-xs text-slate-600 truncate">
          {project.lead ? formatLeadName(project.lead.name) : ''}
        </div>
      </div>
    </div>
  );
}

interface TeamCardProps {
  team: Team;
  className?: string;
}

export function TeamCard({ team, className }: TeamCardProps) {
  const activeProjects = team.projects.nodes.filter(
    (p) => p.state !== 'completed' && p.state !== 'cancelled'
  );
  const completedCount = team.projects.nodes.filter(
    (p) => p.state === 'completed'
  ).length;
  const totalCount = team.projects.nodes.length;

  return (
    <div
      className={cn('rounded-lg border bg-slate-800/40 transition-shadow hover:shadow-lg', className)}
      style={{ borderColor: `${team.color}40` }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 rounded-t-lg px-4 py-3"
        style={{ borderBottom: `1px solid ${team.color}30` }}
      >
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: team.color }}
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="text-sm font-bold tracking-wide text-white">{team.name}</h3>
          <span
            className="rounded px-1.5 py-0.5 text-xs font-mono font-medium"
            style={{ color: team.color, backgroundColor: `${team.color}20` }}
          >
            {team.key}
          </span>
        </div>
        {team.isCUI && <CUIBadge compact />}
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <Layers className="h-3 w-3" />
          {completedCount}/{totalCount}
        </span>
        <Link
          href={`/programs/${team.id}`}
          className="ml-1 rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200"
          title={`Open ${team.name} detail`}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Project rows */}
      <div className="px-4">
        {activeProjects.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-600">
            No active projects
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600">
              <span className="w-24 shrink-0">Status</span>
              <span className="flex-1">Project</span>
              <span className="w-32 shrink-0">Progress</span>
              <span className="w-32 shrink-0 text-right">Target · Lead</span>
            </div>
            <div className="divide-y divide-slate-700/40">
              {activeProjects.map((project: Project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {completedCount > 0 && (
        <div className="border-t border-slate-700/40 px-4 py-2 text-xs text-slate-600">
          {completedCount} project{completedCount !== 1 ? 's' : ''} completed
        </div>
      )}
    </div>
  );
}
