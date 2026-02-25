import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type {
  Team,
  Project,
  Priority,
  ProjectState,
  PortfolioStats,
  DeadlineItem,
  CombinedDeadlineItem,
} from './types';

// ── Tailwind utility merger ────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Priority helpers ──────────────────────────────────────────────────────────

// Static lookup tables — no dynamic Tailwind class interpolation
const PRIORITY_LABELS: Record<number, string> = {
  0: 'No Priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

const PRIORITY_CLASSES: Record<number, string> = {
  0: 'text-slate-400 border-slate-600',
  1: 'text-red-400 border-red-600 bg-red-950/40',
  2: 'text-orange-400 border-orange-600 bg-orange-950/40',
  3: 'text-blue-400 border-blue-600 bg-blue-950/40',
  4: 'text-slate-400 border-slate-600 bg-slate-800/40',
};

export function priorityLabel(priority: Priority): string {
  return PRIORITY_LABELS[priority] ?? 'Unknown';
}

export function priorityClasses(priority: Priority): string {
  return PRIORITY_CLASSES[priority] ?? PRIORITY_CLASSES[0];
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<ProjectState, string> = {
  started:   'bg-blue-900/50 text-blue-300 border border-blue-700',
  planned:   'bg-slate-800/50 text-slate-400 border border-slate-600',
  completed: 'bg-green-900/50 text-green-300 border border-green-700',
  cancelled: 'bg-slate-800/50 text-slate-500 border border-slate-700',
  paused:    'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
};

const STATUS_LABELS: Record<ProjectState, string> = {
  started:   'In Progress',
  planned:   'Planned',
  completed: 'Completed',
  cancelled: 'Cancelled',
  paused:    'Paused',
};

export function statusClasses(state: ProjectState): string {
  return STATUS_CLASSES[state] ?? STATUS_CLASSES['planned'];
}

export function statusLabel(state: ProjectState): string {
  return STATUS_LABELS[state] ?? state;
}

// ── Risk helpers ──────────────────────────────────────────────────────────────

export function isAtRisk(project: Project): boolean {
  if (project.state !== 'started') return false;
  if (!project.targetDate) return false;
  const days = daysUntil(project.targetDate);
  return days >= 0 && days <= 14 && project.progress < 0.7;
}

export function isOverdue(project: Project): boolean {
  if (project.state === 'completed' || project.state === 'cancelled') return false;
  if (project.progress >= 1) return false; // 100% done — just needs Linear state closed
  if (!project.targetDate) return false;
  return daysUntil(project.targetDate) < 0;
}

// ── Display helpers ────────────────────────────────────────────────────────────

/**
 * Formats a lead name for display. If Linear returns an email address,
 * strips the domain and title-cases the local part (e.g. "billy.battles@colvinrun.com" → "Billy Battles").
 * Real display names pass through unchanged.
 */
export function formatLeadName(raw: string): string {
  if (!raw.includes('@')) return raw; // already a display name
  const local = raw.split('@')[0]; // e.g. "billy.battles"
  return local
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ── Portfolio stats ───────────────────────────────────────────────────────────

export function computeStats(teams: Team[]): PortfolioStats {
  const projects = teams.flatMap((t) => t.projects.nodes);
  return {
    active:    projects.filter((p) => p.state === 'started').length,
    completed: projects.filter((p) => p.state === 'completed').length,
    overdue:   projects.filter((p) => isOverdue(p)).length,
    atRisk:    projects.filter((p) => isAtRisk(p)).length,
    onTrack:   projects.filter(
      (p) => p.state === 'started' && !isAtRisk(p) && !isOverdue(p)
    ).length,
  };
}

// ── Deadline derivation ───────────────────────────────────────────────────────

export function computeDeadlines(
  teams: Team[],
  windowDays = 30
): DeadlineItem[] {
  const items: DeadlineItem[] = [];
  for (const team of teams) {
    for (const project of team.projects.nodes) {
      if (!project.targetDate) continue;
      if (project.state === 'completed' || project.state === 'cancelled') continue;
      const days = daysUntil(project.targetDate);
      if (days >= 0 && days <= windowDays) {
        items.push({
          projectId:   project.id,
          projectName: project.name,
          teamId:      team.id,
          teamName:    team.name,
          teamColor:   team.color,
          targetDate:  project.targetDate,
          daysUntil:   days,
          progress:    project.progress,
        });
      }
    }
  }
  return items.sort((a, b) => a.daysUntil - b.daysUntil);
}

// ── Progress color ────────────────────────────────────────────────────────────

export function progressColor(progress: number): string {
  if (progress >= 0.8) return 'bg-green-500';
  if (progress >= 0.5) return 'bg-blue-500';
  if (progress >= 0.25) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ── Project health helpers ────────────────────────────────────────────────────

import type { ProjectHealth } from './types';

const HEALTH_CLASSES: Record<ProjectHealth, string> = {
  onTrack:  'bg-green-900/50 text-green-300 border border-green-800',
  atRisk:   'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  offTrack: 'bg-red-900/50 text-red-300 border border-red-800',
};

const HEALTH_LABELS: Record<ProjectHealth, string> = {
  onTrack:  'On Track',
  atRisk:   'At Risk',
  offTrack: 'Off Track',
};

export function healthClasses(health: ProjectHealth): string {
  return HEALTH_CLASSES[health];
}

export function healthLabel(health: ProjectHealth): string {
  return HEALTH_LABELS[health];
}

// ── Milestone status helpers ──────────────────────────────────────────────────

import type { MilestoneStatus } from './types';

const MILESTONE_STATUS_CLASSES: Record<MilestoneStatus, string> = {
  unstarted: 'bg-slate-800/50 text-slate-400 border border-slate-600',
  next:      'bg-blue-900/50 text-blue-300 border border-blue-700',
  overdue:   'bg-red-900/50 text-red-300 border border-red-700',
  done:      'bg-green-900/50 text-green-300 border border-green-700',
};

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  unstarted: 'Not Started',
  next:      'Up Next',
  overdue:   'Overdue',
  done:      'Done',
};

export function milestoneStatusClasses(status: MilestoneStatus): string {
  return MILESTONE_STATUS_CLASSES[status] ?? MILESTONE_STATUS_CLASSES.unstarted;
}

export function milestoneStatusLabel(status: MilestoneStatus): string {
  return MILESTONE_STATUS_LABELS[status] ?? status;
}

// ── Combined deadline derivation (projects + milestones) ──────────────────────

export function computeCombinedDeadlines(
  teams: Team[],
  windowDays = 30
): CombinedDeadlineItem[] {
  const items: CombinedDeadlineItem[] = [];

  for (const team of teams) {
    for (const project of team.projects.nodes) {
      const projectActive =
        project.state !== 'completed' && project.state !== 'cancelled';

      // Project-level deadline
      if (projectActive && project.targetDate) {
        const days = daysUntil(project.targetDate);
        if (days >= 0 && days <= windowDays) {
          items.push({
            kind:        'project',
            id:          project.id,
            label:       project.name,
            projectId:   project.id,
            projectName: project.name,
            teamId:      team.id,
            teamName:    team.name,
            teamColor:   team.color,
            targetDate:  project.targetDate,
            daysUntil:   days,
            progress:    project.progress,
          });
        }
      }

      // Milestone-level deadlines (include even if project is completed,
      // so overdue milestones on closed projects don't silently disappear)
      for (const ms of (project.projectMilestones?.nodes ?? [])) {
        if (ms.status === 'done') continue; // already done — skip
        if (!ms.targetDate) continue;
        const days = daysUntil(ms.targetDate);
        if (days >= 0 && days <= windowDays) {
          items.push({
            kind:            'milestone',
            id:              ms.id,
            label:           ms.name,
            projectId:       project.id,
            projectName:     project.name,
            teamId:          team.id,
            teamName:        team.name,
            teamColor:       team.color,
            targetDate:      ms.targetDate,
            daysUntil:       days,
            progress:        ms.progress,
            milestoneStatus: ms.status,
          });
        }
      }
    }
  }

  return items.sort((a, b) => a.daysUntil - b.daysUntil);
}
