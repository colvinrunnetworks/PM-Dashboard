'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { fetchPortfolioWithMilestones, fetchBacklogByProject } from '@/lib/api';
import type { BacklogMap } from '@/lib/api';
import { isOverdue, isAtRisk, daysUntil, formatDate, formatLeadName, formatTimestamp } from '@/lib/utils';
import type { Team, Project, Milestone } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthlyIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  state: { name: string; type: string };
  project: { id: string; name: string } | null;
  completedAt?: string;
  createdAt?: string;
}

interface MonthlyData {
  completedIssues: MonthlyIssue[];
  createdIssues: MonthlyIssue[];
}

interface RiskProject {
  project: Project;
  flags: string[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function prevMonthDefault(): { year: number; month: number } {
  const now = new Date();
  return now.getMonth() === 0
    ? { year: now.getFullYear() - 1, month: 12 }
    : { year: now.getFullYear(), month: now.getMonth() }; // getMonth() is 0-indexed so .month for 1-indexed prev
}

function monthOptions(): { year: number; month: number; label: string }[] {
  const options: { year: number; month: number; label: string }[] = [];
  let d = new Date();
  for (let i = 0; i < 13; i++) {
    options.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }
  return options;
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function groupIssuesByProject(issues: MonthlyIssue[]): { projectName: string; issues: MonthlyIssue[] }[] {
  const map = new Map<string, MonthlyIssue[]>();
  for (const issue of issues) {
    const key = issue.project?.name ?? '(No project)';
    const arr = map.get(key) ?? [];
    arr.push(issue);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([projectName, issues]) => ({ projectName, issues }))
    .sort((a, b) => b.issues.length - a.issues.length);
}

function milestonesHitInMonth(team: Team, year: number, month: number): Array<{ ms: Milestone; projectName: string }> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end   = new Date(Date.UTC(year, month, 1));
  const result: Array<{ ms: Milestone; projectName: string }> = [];
  for (const p of team.projects.nodes) {
    for (const ms of p.projectMilestones?.nodes ?? []) {
      if (ms.status === 'done' && ms.targetDate) {
        const d = new Date(ms.targetDate + 'T00:00:00Z');
        if (d >= start && d < end) result.push({ ms, projectName: p.name });
      }
    }
  }
  return result.sort((a, b) =>
    new Date(a.ms.targetDate!).getTime() - new Date(b.ms.targetDate!).getTime(),
  );
}

function milestonesUpcoming(team: Team, withinDays: number): Array<{ ms: Milestone; projectName: string; daysLeft: number }> {
  const now    = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const result: Array<{ ms: Milestone; projectName: string; daysLeft: number }> = [];
  for (const p of team.projects.nodes) {
    if (p.state === 'cancelled') continue;
    for (const ms of p.projectMilestones?.nodes ?? []) {
      if (ms.status !== 'done' && ms.targetDate) {
        const d = new Date(ms.targetDate + 'T00:00:00Z');
        if (d >= now && d <= cutoff) {
          result.push({ ms, projectName: p.name, daysLeft: Math.ceil((d.getTime() - now.getTime()) / 86400000) });
        }
      }
    }
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft);
}

function computeTeamRisks(team: Team, backlogMap: BacklogMap): RiskProject[] {
  return team.projects.nodes
    .filter(p => p.state !== 'completed' && p.state !== 'cancelled')
    .flatMap(p => {
      const flags: string[] = [];
      const days = p.targetDate ? daysUntil(p.targetDate) : null;
      const backlogCount = backlogMap[p.id]?.length ?? 0;

      if (isOverdue(p))            flags.push('Overdue');
      else if (isAtRisk(p))        flags.push('At Risk');
      else if (days !== null && days >= 0 && days <= 30 && p.progress < 0.5) flags.push('Due Soon');

      if (p.state === 'paused')    flags.push('On Hold');
      if (p.state === 'started' && p.progress === 0 && p.startDate && daysUntil(p.startDate) < 0) flags.push('Stalled');
      if (!p.targetDate)           flags.push('No Deadline');
      if (!p.lead)                 flags.push('No Lead');
      if (backlogCount > 0)        flags.push('Backlog Issues');

      return flags.length > 0 ? [{ project: p, flags }] : [];
    });
}

const RISK_FLAG_COLOR: Record<string, string> = {
  'Overdue':        '#f87171',
  'At Risk':        '#fb923c',
  'Due Soon':       '#fbbf24',
  'Stalled':        '#c084fc',
  'On Hold':        '#60a5fa',
  'No Deadline':    '#94a3b8',
  'No Lead':        '#94a3b8',
  'Backlog Issues': '#fbbf24',
};

function triggerDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function openReport(html: string) {
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Dashboard section wrapper ─────────────────────────────────────────────────

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40">
      <div className="flex items-baseline gap-3 border-b border-slate-700/40 px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
        {meta && <span className="text-xs text-slate-600">{meta}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Section 1: Portfolio Snapshot ─────────────────────────────────────────────

function PortfolioSnapshot({ team }: { team: Team }) {
  const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
  const inProgress = active.filter(p => p.state === 'started').length;
  const planned    = active.filter(p => p.state === 'planned').length;
  const onHold     = active.filter(p => p.state === 'paused').length;
  const completed  = team.projects.nodes.filter(p => p.state === 'completed').length;

  const healthOn  = active.filter(p => p.health === 'onTrack').length;
  const healthAt  = active.filter(p => p.health === 'atRisk').length;
  const healthOff = active.filter(p => p.health === 'offTrack').length;
  const healthNA  = active.filter(p => p.health === null).length;

  const STATE_COLOR: Record<string, string> = {
    started: 'text-green-400', planned: 'text-blue-400',
    paused: 'text-slate-500', completed: 'text-slate-600',
  };
  const STATE_LABEL: Record<string, string> = {
    started: 'In Progress', planned: 'Planned', paused: 'On Hold', completed: 'Completed',
  };
  const HEALTH_COLOR: Record<string, string> = {
    onTrack: 'text-green-400', atRisk: 'text-amber-400', offTrack: 'text-red-400',
  };
  const HEALTH_LABEL: Record<string, string> = {
    onTrack: 'On Track', atRisk: 'At Risk', offTrack: 'Off Track',
  };

  if (active.length === 0) {
    return <p className="text-sm text-slate-600 py-2">No active projects for this team.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-slate-100">{active.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Active</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-green-400">{inProgress}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">In Progress</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-blue-400">{planned}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Planned</div>
        </div>
        {onHold > 0 && (
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
            <div className="text-2xl font-bold text-slate-500">{onHold}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">On Hold</div>
          </div>
        )}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-slate-600">{completed}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">All-Time Done</div>
        </div>
        {(healthOn + healthAt + healthOff) > 0 && (
          <>
            {healthOn  > 0 && <div className="rounded-lg border border-green-800/40  bg-green-950/20  px-4 py-3 text-center min-w-20"><div className="text-2xl font-bold text-green-400">{healthOn}</div><div className="text-xs text-green-700 uppercase tracking-wider mt-1">On Track</div></div>}
            {healthAt  > 0 && <div className="rounded-lg border border-amber-800/40  bg-amber-950/20  px-4 py-3 text-center min-w-20"><div className="text-2xl font-bold text-amber-400">{healthAt}</div><div className="text-xs text-amber-700 uppercase tracking-wider mt-1">At Risk</div></div>}
            {healthOff > 0 && <div className="rounded-lg border border-red-800/40    bg-red-950/20    px-4 py-3 text-center min-w-20"><div className="text-2xl font-bold text-red-400">{healthOff}</div><div className="text-xs text-red-700 uppercase tracking-wider mt-1">Off Track</div></div>}
          </>
        )}
      </div>

      {/* Project table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Project</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500">State</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Progress</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Lead</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500">Target Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {active.map(p => {
              const pct = Math.round(p.progress * 100);
              const overdue = isOverdue(p);
              return (
                <tr key={p.id} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-3 py-2">
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-slate-200 font-medium hover:text-blue-400 transition-colors">
                      {p.name}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold ${STATE_COLOR[p.state] ?? 'text-slate-400'}`}>
                      {STATE_LABEL[p.state] ?? p.state}
                    </span>
                    {p.health && (
                      <span className={`ml-2 text-xs ${HEALTH_COLOR[p.health] ?? 'text-slate-500'}`}>
                        · {HEALTH_LABEL[p.health]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: pct >= 75 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#60a5fa' }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{pct}%</span>
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-xs ${p.lead ? 'text-slate-400' : 'text-slate-700 italic'}`}>
                    {p.lead ? formatLeadName(p.lead.name) : 'No lead'}
                  </td>
                  <td className={`px-3 py-2 text-xs ${overdue ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                    {formatDate(p.targetDate)}
                    {overdue && <span className="ml-1 text-red-500">overdue</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section 2: Work Completed ─────────────────────────────────────────────────

function WorkCompleted({ data, monthLabel }: { data: MonthlyData; monthLabel: string }) {
  const { completedIssues, createdIssues } = data;
  const groups = groupIssuesByProject(completedIssues);
  const velocity = createdIssues.length > 0
    ? (completedIssues.length / createdIssues.length).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-green-400">{completedIssues.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Closed</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-center min-w-20">
          <div className="text-2xl font-bold text-blue-400">{createdIssues.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Opened</div>
        </div>
        {velocity !== null && (
          <div className={`rounded-lg border px-4 py-3 text-center min-w-20 ${
            parseFloat(velocity) >= 1
              ? 'border-green-800/40 bg-green-950/20'
              : 'border-amber-800/40 bg-amber-950/20'
          }`}>
            <div className={`text-2xl font-bold ${parseFloat(velocity) >= 1 ? 'text-green-400' : 'text-amber-400'}`}>{velocity}×</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Velocity</div>
          </div>
        )}
      </div>

      {completedIssues.length === 0 ? (
        <p className="text-sm text-slate-600 py-2">No issues closed in {monthLabel}.</p>
      ) : (
        <div className="space-y-3">
          {groups.map(({ projectName, issues }) => (
            <div key={projectName}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-400">{projectName}</span>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">{issues.length}</span>
              </div>
              <div className="space-y-0.5 pl-3">
                {issues.map(issue => (
                  <div key={issue.id} className="flex items-baseline gap-2">
                    <span className="text-xs font-mono text-slate-600 shrink-0">{issue.identifier}</span>
                    <span className="text-sm text-slate-300 truncate">{issue.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-700 border-t border-slate-700/30 pt-3 mt-2">
        <span className="font-semibold text-slate-600">CRISP-DM phase grouping:</span> Add issue labels
        (e.g. <span className="font-mono">CRISP: Modeling</span>) in Linear to automatically group
        completed work by methodology phase in future reports.
      </p>
    </div>
  );
}

// ── Section 3: Milestones ─────────────────────────────────────────────────────

function MilestonesSection({ team, year, month }: { team: Team; year: number; month: number }) {
  const hit      = milestonesHitInMonth(team, year, month);
  const upcoming = milestonesUpcoming(team, 60);
  const near     = upcoming.filter(m => m.daysLeft <= 30);
  const later    = upcoming.filter(m => m.daysLeft > 30);

  const msRow = ({ ms, projectName, daysLeft }: { ms: Milestone; projectName: string; daysLeft?: number }) => (
    <div key={ms.id} className="flex items-start gap-3 py-1.5">
      <span className="text-slate-600 text-xs mt-0.5 shrink-0">{formatDate(ms.targetDate)}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-slate-200">{ms.name}</span>
        <span className="ml-2 text-xs text-slate-600">{projectName}</span>
      </div>
      {daysLeft !== undefined && (
        <span className={`text-xs font-semibold shrink-0 ${daysLeft <= 14 ? 'text-amber-400' : 'text-slate-500'}`}>
          {daysLeft}d
        </span>
      )}
    </div>
  );

  const empty = hit.length === 0 && upcoming.length === 0;
  if (empty) return <p className="text-sm text-slate-600 py-2">No milestones recorded for this period.</p>;

  return (
    <div className="space-y-4">
      {hit.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Completed this month <span className="text-green-600 normal-case font-normal tracking-normal">({hit.length})</span>
          </div>
          <div className="divide-y divide-slate-700/30">
            {hit.map(({ ms, projectName }) => (
              <div key={ms.id} className="flex items-start gap-3 py-1.5">
                <span className="text-green-600 text-xs mt-0.5 shrink-0">✓</span>
                <span className="text-xs text-slate-600 mt-0.5 shrink-0">{formatDate(ms.targetDate)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-200">{ms.name}</span>
                  <span className="ml-2 text-xs text-slate-600">{projectName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {near.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Due next 30 days</div>
          <div className="divide-y divide-slate-700/30">
            {near.map(m => msRow(m))}
          </div>
        </div>
      )}
      {later.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Due 31–60 days</div>
          <div className="divide-y divide-slate-700/30">
            {later.map(m => msRow(m))}
          </div>
        </div>
      )}
      <p className="text-xs text-slate-700 pt-1">
        "Completed this month" uses milestone target date as a proxy — actual completion date not available in Linear.
      </p>
    </div>
  );
}

// ── Section 4: Risks & Issues ─────────────────────────────────────────────────

function RisksSection({ team, backlogMap }: { team: Team; backlogMap: BacklogMap }) {
  const risks = computeTeamRisks(team, backlogMap);
  if (risks.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-800/40 bg-green-950/20 px-4 py-3 text-sm text-green-400">
        <span>✓</span><span>No active risk flags for this team.</span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {risks.map(({ project, flags }) => (
        <div key={project.id} className="flex items-start gap-3 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2.5">
          <span className="flex-1 text-sm text-slate-200 font-medium">{project.name}</span>
          <div className="flex flex-wrap gap-1.5 justify-end">
            {flags.map(flag => (
              <span
                key={flag}
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ color: RISK_FLAG_COLOR[flag] ?? '#94a3b8', backgroundColor: `${RISK_FLAG_COLOR[flag] ?? '#94a3b8'}18` }}
              >
                {flag}
              </span>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-700 pt-1">
        {risks.length} project{risks.length !== 1 ? 's' : ''} with active flags.
        Flags: Overdue, At Risk, Due Soon, Stalled, On Hold, No Deadline, No Lead, Backlog Issues.
      </p>
    </div>
  );
}

// ── Section 5: Next Period ────────────────────────────────────────────────────

function NextPeriodSection({ team, backlogMap }: { team: Team; backlogMap: BacklogMap }) {
  const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');

  const due30  = active.filter(p => p.targetDate && daysUntil(p.targetDate) >= 0 && daysUntil(p.targetDate) <= 30);
  const due60  = active.filter(p => p.targetDate && daysUntil(p.targetDate) > 30 && daysUntil(p.targetDate) <= 60);
  const noDate = active.filter(p => !p.targetDate);

  const totalBacklog = active.reduce((s, p) => s + (backlogMap[p.id]?.length ?? 0), 0);
  const upcoming = milestonesUpcoming(team, 30);

  const projRow = (p: Project) => {
    const days = daysUntil(p.targetDate!);
    return (
      <div key={p.id} className="flex items-center gap-3 py-1.5">
        <span className="flex-1 text-sm text-slate-200">{p.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-1.5 w-16 rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
          <span className="text-xs text-slate-500 w-8 text-right">{Math.round(p.progress * 100)}%</span>
        </div>
        <span className={`text-xs font-semibold shrink-0 w-20 text-right ${days <= 14 ? 'text-amber-400' : 'text-slate-500'}`}>
          {formatDate(p.targetDate)}
        </span>
      </div>
    );
  };

  const empty = due30.length === 0 && due60.length === 0 && upcoming.length === 0 && totalBacklog === 0;
  if (empty) return <p className="text-sm text-slate-600 py-2">No upcoming deadlines in the next 60 days.</p>;

  return (
    <div className="space-y-4">
      {due30.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Project deadlines — next 30 days
            <span className="ml-2 text-amber-600 normal-case font-normal tracking-normal">({due30.length})</span>
          </div>
          <div className="divide-y divide-slate-700/30">
            {due30.sort((a, b) => daysUntil(a.targetDate!) - daysUntil(b.targetDate!)).map(projRow)}
          </div>
        </div>
      )}
      {due60.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Project deadlines — 31–60 days</div>
          <div className="divide-y divide-slate-700/30">
            {due60.sort((a, b) => daysUntil(a.targetDate!) - daysUntil(b.targetDate!)).map(projRow)}
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Milestones due next 30 days</div>
          <div className="divide-y divide-slate-700/30">
            {upcoming.map(({ ms, projectName, daysLeft }) => (
              <div key={ms.id} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 text-sm text-slate-200">{ms.name}</span>
                <span className="text-xs text-slate-600">{projectName}</span>
                <span className={`text-xs font-semibold shrink-0 ${daysLeft <= 14 ? 'text-amber-400' : 'text-slate-500'}`}>{formatDate(ms.targetDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {totalBacklog > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-800/30 bg-amber-950/10 px-4 py-3">
          <span className="text-2xl font-bold text-amber-400">{totalBacklog}</span>
          <div>
            <div className="text-sm font-semibold text-slate-300">Backlog issues need triage</div>
            <div className="text-xs text-slate-600">Unprioritized issues across {active.filter(p => (backlogMap[p.id]?.length ?? 0) > 0).length} project{active.filter(p => (backlogMap[p.id]?.length ?? 0) > 0).length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}
      {noDate.length > 0 && (
        <p className="text-xs text-slate-700">
          {noDate.length} active project{noDate.length !== 1 ? 's' : ''} without a target date: {noDate.map(p => p.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

// ── HTML export ───────────────────────────────────────────────────────────────

function generateMonthlyHTML(
  team: Team,
  label: string,
  data: MonthlyData,
  backlogMap: BacklogMap,
  year: number,
  month: number,
  generatedAt: string,
): string {
  const esc = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
  const STATE_LABEL: Record<string, string> = { started: 'In Progress', planned: 'Planned', paused: 'On Hold' };

  // Section 1
  const snap1 = `
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px">1. Portfolio Snapshot</h2>
  <p style="font-size:11px;color:#6b7280;margin:0 0 12px">${active.length} active projects as of ${esc(generatedAt)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">
    <thead><tr style="background:#f3f4f6">
      ${['Project','State','Progress','Lead','Target Date'].map(h => `<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af">${h}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${active.map(p => `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:5px 8px;font-weight:500;color:#111827">${esc(p.name)}</td>
        <td style="padding:5px 8px;color:#374151">${esc(STATE_LABEL[p.state] ?? p.state)}</td>
        <td style="padding:5px 8px;color:#374151">${Math.round(p.progress * 100)}%</td>
        <td style="padding:5px 8px;color:#374151">${p.lead ? esc(formatLeadName(p.lead.name)) : '<span style="color:#d1d5db;font-style:italic">No lead</span>'}</td>
        <td style="padding:5px 8px;color:${isOverdue(p) ? '#dc2626' : '#374151'}">${esc(formatDate(p.targetDate))}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Section 2
  const groups = groupIssuesByProject(data.completedIssues);
  const closedRows = groups.map(({ projectName, issues }) => `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:4px">${esc(projectName)} <span style="font-weight:400;color:#9ca3af">(${issues.length})</span></div>
      ${issues.map(i => `<div style="padding:2px 0 2px 12px;font-size:11px;color:#374151"><span style="font-family:monospace;color:#9ca3af;font-size:10px">${esc(i.identifier)}</span> ${esc(i.title)}</div>`).join('')}
    </div>`).join('');
  const snap2 = `
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 8px">2. Work Completed</h2>
  <p style="font-size:11px;color:#6b7280;margin:0 0 12px">${data.completedIssues.length} issues closed · ${data.createdIssues.length} opened in ${esc(label)}</p>
  ${data.completedIssues.length === 0 ? '<p style="font-size:11px;color:#9ca3af">No issues closed in this period.</p>' : closedRows}
  <p style="font-size:10px;color:#d1d5db;margin-top:8px">Add CRISP-DM labels in Linear to enable phase grouping in future reports.</p>`;

  // Section 3
  const hit      = milestonesHitInMonth(team, year, month);
  const upcoming = milestonesUpcoming(team, 60);
  const msRows = (arr: typeof upcoming) => arr.map(({ ms, projectName }) =>
    `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:5px 8px;color:#6b7280">${esc(formatDate(ms.targetDate))}</td><td style="padding:5px 8px;color:#111827">${esc(ms.name)}</td><td style="padding:5px 8px;color:#9ca3af">${esc(projectName)}</td></tr>`
  ).join('');
  const snap3 = `
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 8px">3. Milestones</h2>
  ${hit.length > 0 ? `<p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px">Completed this month</p>
  <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px"><tbody>${hit.map(({ ms, projectName }) =>
    `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:5px 8px;color:#16a34a">✓</td><td style="padding:5px 8px;color:#6b7280">${esc(formatDate(ms.targetDate))}</td><td style="padding:5px 8px;color:#111827">${esc(ms.name)}</td><td style="padding:5px 8px;color:#9ca3af">${esc(projectName)}</td></tr>`
  ).join('')}</tbody></table>` : ''}
  ${upcoming.length > 0 ? `<p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px">Upcoming (60 days)</p>
  <table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>${msRows(upcoming)}</tbody></table>` : ''}
  ${hit.length === 0 && upcoming.length === 0 ? '<p style="font-size:11px;color:#9ca3af">No milestones recorded for this period.</p>' : ''}`;

  // Section 4
  const risks = computeTeamRisks(team, backlogMap);
  const PILL_COLOR_HTML: Record<string, string> = {
    'Overdue':'#dc2626','At Risk':'#d97706','Due Soon':'#ca8a04',
    'Stalled':'#7c3aed','On Hold':'#2563eb','No Deadline':'#6b7280',
    'No Lead':'#6b7280','Backlog Issues':'#b45309',
  };
  const snap4 = `
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 8px">4. Risks &amp; Issues Identified</h2>
  ${risks.length === 0
    ? '<p style="font-size:11px;color:#16a34a">✓ No active risk flags for this team.</p>'
    : `<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>${risks.map(({ project, flags }) =>
        `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 8px;font-weight:500;color:#111827">${esc(project.name)}</td>
          <td style="padding:5px 8px">${flags.map(f => `<span style="padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;color:${PILL_COLOR_HTML[f]??'#6b7280'};background:${(PILL_COLOR_HTML[f]??'#6b7280')}18;margin-right:4px">${esc(f)}</span>`).join('')}</td>
        </tr>`
      ).join('')}</tbody></table>`}`;

  // Section 5
  const due30 = active.filter(p => p.targetDate && daysUntil(p.targetDate) >= 0 && daysUntil(p.targetDate) <= 30);
  const due60 = active.filter(p => p.targetDate && daysUntil(p.targetDate) > 30 && daysUntil(p.targetDate) <= 60);
  const upMS  = milestonesUpcoming(team, 30);
  const totalBacklog = active.reduce((s, p) => s + (backlogMap[p.id]?.length ?? 0), 0);
  const projHtml = (projects: Project[]) => projects.map(p =>
    `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:5px 8px;color:#111827">${esc(p.name)}</td>
      <td style="padding:5px 8px;color:#374151">${Math.round(p.progress * 100)}%</td>
      <td style="padding:5px 8px;color:${isOverdue(p)?'#dc2626':'#374151'}">${esc(formatDate(p.targetDate))}</td>
    </tr>`
  ).join('');
  const snap5 = `
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 8px">5. Plans for Next Reporting Period</h2>
  ${due30.length > 0 ? `<p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px">Deadlines — next 30 days</p>
  <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px"><thead><tr style="background:#f3f4f6">${['Project','Progress','Date'].map(h=>`<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af">${h}</th>`).join('')}</tr></thead><tbody>${projHtml(due30)}</tbody></table>` : ''}
  ${due60.length > 0 ? `<p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px">Deadlines — 31–60 days</p>
  <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px"><tbody>${projHtml(due60)}</tbody></table>` : ''}
  ${upMS.length > 0 ? `<p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px">Milestones due next 30 days</p>
  <div style="font-size:11px">${upMS.map(({ ms, projectName }) => `<div style="padding:3px 0"><span style="color:#6b7280">${esc(formatDate(ms.targetDate))}</span> — ${esc(ms.name)} <span style="color:#9ca3af">(${esc(projectName)})</span></div>`).join('')}</div>` : ''}
  ${totalBacklog > 0 ? `<div style="margin-top:12px;padding:10px 14px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;font-size:11px"><strong style="color:#92400e">${totalBacklog} backlog issues</strong> <span style="color:#6b7280">require triage before next sprint.</span></div>` : ''}
  ${due30.length === 0 && due60.length === 0 && upMS.length === 0 && totalBacklog === 0 ? '<p style="font-size:11px;color:#9ca3af">No upcoming deadlines in the next 60 days.</p>' : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(team.name)} Monthly Status Report — ${esc(label)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;}
body{font-family:system-ui,'Segoe UI',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:32px;max-width:1100px;margin:0 auto;}
h2{margin-top:40px;}h2:first-child{margin-top:0;}
@media print{@page{margin:1.5cm;size:A4 portrait;}body{padding:0;}h2{page-break-before:always;}h2:first-child{page-break-before:avoid;}}
</style>
</head>
<body>
<div style="margin-bottom:24px;border-bottom:2px solid #1e40af;padding-bottom:12px">
  <div style="font-size:9px;font-weight:700;letter-spacing:.15em;color:#1e40af;text-transform:uppercase;margin-bottom:2px">COLVIN RUN NETWORKS</div>
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0">${esc(team.name)} — Monthly Status Report</h1>
  <p style="font-size:11px;color:#6b7280;margin:4px 0 0">${esc(label)} · Generated ${esc(generatedAt)}</p>
</div>
${snap1}
<div style="height:32px"></div>
${snap2}
<div style="height:32px"></div>
${snap3}
<div style="height:32px"></div>
${snap4}
<div style="height:32px"></div>
${snap5}
<div style="margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between">
  <span>Colvin Run Networks — SBIR PM Dashboard</span>
  <span>Data sourced from Linear · ${esc(generatedAt)}</span>
</div>
</body>
</html>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MonthlyPage() {
  const [teams, setTeams]               = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [year, setYear]                 = useState(() => prevMonthDefault().year);
  const [month, setMonth]               = useState(() => prevMonthDefault().month);
  const [monthlyData, setMonthlyData]   = useState<MonthlyData | null>(null);
  const [backlogMap, setBacklogMap]     = useState<BacklogMap>({});
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [generatedAt, setGeneratedAt]   = useState('');

  // Load teams + backlog once
  useEffect(() => {
    setLoadingTeams(true);
    Promise.all([fetchPortfolioWithMilestones(), fetchBacklogByProject()])
      .then(([loadedTeams, bm]) => {
        setTeams(loadedTeams);
        setBacklogMap(bm);
        if (loadedTeams.length > 0) setSelectedTeamId(loadedTeams[0].id);
        setGeneratedAt(formatTimestamp(new Date()));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoadingTeams(false));
  }, []);

  // Load monthly issues when team or month changes
  const loadMonthly = useCallback(async (teamId: string, y: number, m: number) => {
    if (!teamId) return;
    setLoadingMonthly(true);
    setMonthlyData(null);
    try {
      const res = await fetch(`/api/monthly?teamId=${encodeURIComponent(teamId)}&year=${y}&month=${m}`);
      if (!res.ok) throw new Error(`Monthly API failed: ${res.status}`);
      const json = await res.json();
      setMonthlyData({
        completedIssues: json.completedIssues?.nodes ?? [],
        createdIssues:   json.createdIssues?.nodes   ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load monthly data');
    } finally {
      setLoadingMonthly(false);
    }
  }, []);

  useEffect(() => {
    loadMonthly(selectedTeamId, year, month);
  }, [selectedTeamId, year, month, loadMonthly]);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);
  const options      = monthOptions();
  const label        = monthLabel(year, month);
  const dateSlug     = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Monthly Status Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Auto-generated from Linear data · no manual input required
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">

          {/* Team selector */}
          <select
            value={selectedTeamId}
            onChange={e => setSelectedTeamId(e.target.value)}
            disabled={loadingTeams}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {/* Month selector */}
          <select
            value={`${year}-${month}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number);
              setYear(y); setMonth(m);
            }}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {options.map(o => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
            ))}
          </select>

          {/* Download */}
          <button
            onClick={() => {
              if (!selectedTeam || !monthlyData) return;
              const html = generateMonthlyHTML(selectedTeam, label, monthlyData, backlogMap, year, month, generatedAt);
              triggerDownload(html, 'text/html;charset=utf-8', `${selectedTeam.key}-monthly-${dateSlug}.html`);
            }}
            disabled={loadingTeams || loadingMonthly || !selectedTeam || !monthlyData}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            <FileText size={13} />
            Download HTML
          </button>

          {/* Open report */}
          <button
            onClick={() => {
              if (!selectedTeam || !monthlyData) return;
              const html = generateMonthlyHTML(selectedTeam, label, monthlyData, backlogMap, year, month, generatedAt);
              openReport(html);
            }}
            disabled={loadingTeams || loadingMonthly || !selectedTeam || !monthlyData}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <FileText size={13} />
            Open Report
          </button>
        </div>
      </div>

      {/* Loading / error */}
      {(loadingTeams || loadingMonthly) && (
        <div className="flex items-center gap-2 py-12 text-slate-500 text-sm justify-center">
          <RefreshCw size={14} className="animate-spin" />
          {loadingTeams ? 'Loading portfolio…' : `Loading ${label} data…`}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      {selectedTeam && monthlyData && !loadingTeams && !loadingMonthly && (
        <>
          {/* Team header pill */}
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedTeam.color }} />
            <span className="text-sm font-semibold text-slate-300">{selectedTeam.name}</span>
            <span className="rounded px-1.5 py-0.5 text-xs font-mono" style={{ color: selectedTeam.color, backgroundColor: `${selectedTeam.color}20` }}>{selectedTeam.key}</span>
            <span className="text-slate-600 text-xs ml-1">· {label}</span>
          </div>

          <Section title="1. Portfolio Snapshot" meta="current state of active projects">
            <PortfolioSnapshot team={selectedTeam} />
          </Section>

          <Section title="2. Work Completed" meta={label}>
            <WorkCompleted data={monthlyData} monthLabel={label} />
          </Section>

          <Section title="3. Milestones">
            <MilestonesSection team={selectedTeam} year={year} month={month} />
          </Section>

          <Section title="4. Risks &amp; Issues Identified" meta="active flags from Linear">
            <RisksSection team={selectedTeam} backlogMap={backlogMap} />
          </Section>

          <Section title="5. Plans for Next Reporting Period" meta="next 60 days">
            <NextPeriodSection team={selectedTeam} backlogMap={backlogMap} />
          </Section>
        </>
      )}
    </div>
  );
}
