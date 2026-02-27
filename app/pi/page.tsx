'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Target, CheckCircle2, Clock, AlertTriangle, Circle,
  ChevronDown, ChevronUp, ExternalLink, Zap,
} from 'lucide-react';
import { RefreshButton } from '@/components/RefreshButton';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import {
  cn, formatDate, daysUntil, isOverdue, isAtRisk,
  statusLabel, healthLabel, healthClasses, formatLeadName,
} from '@/lib/utils';
import type { Team, Project, Milestone } from '@/lib/types';

// ── Calendar quarter helpers ──────────────────────────────────────────────────

interface Quarter {
  q: number;       // 1–4
  year: number;
  label: string;   // "Q2 2026"
  start: Date;
  end: Date;
}

function buildQuarter(q: number, year: number): Quarter {
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end   = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { q, year, label: `Q${q} ${year}`, start, end };
}

function currentQuarter(): Quarter {
  const now = new Date();
  const q   = Math.floor(now.getMonth() / 3) + 1;
  return buildQuarter(q, now.getFullYear());
}

function quartersForYear(year: number): Quarter[] {
  return [1, 2, 3, 4].map((q) => buildQuarter(q, year));
}

function quarterForDate(iso: string): Quarter {
  const d = new Date(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return buildQuarter(q, d.getFullYear());
}

function sameQuarter(a: Quarter, b: Quarter): boolean {
  return a.q === b.q && a.year === b.year;
}

function quarterProgress(q: Quarter): number {
  const now   = Date.now();
  const start = q.start.getTime();
  const end   = q.end.getTime();
  if (now <= start) return 0;
  if (now >= end)   return 1;
  return (now - start) / (end - start);
}

// ── Milestone helpers ─────────────────────────────────────────────────────────

function milestonesInQuarter(team: Team, q: Quarter): Milestone[] {
  const seen = new Set<string>();
  const out: Milestone[] = [];
  for (const project of team.projects.nodes) {
    for (const ms of project.projectMilestones?.nodes ?? []) {
      if (!ms.targetDate || seen.has(ms.id)) continue;
      const mq = quarterForDate(ms.targetDate);
      if (sameQuarter(mq, q)) {
        seen.add(ms.id);
        out.push(ms);
      }
    }
  }
  return out.sort((a, b) =>
    new Date(a.targetDate!).getTime() - new Date(b.targetDate!).getTime()
  );
}

// ── ART health rollup ─────────────────────────────────────────────────────────

type ARTHealth = 'green' | 'yellow' | 'red' | 'grey';

function artHealth(projects: Project[]): ARTHealth {
  const active = projects.filter((p) => p.state === 'started');
  if (!active.length) return 'grey';
  if (active.some(isOverdue))          return 'red';
  if (active.some(isAtRisk))           return 'yellow';
  return 'green';
}

const ART_HEALTH = {
  green:  { dot: 'bg-green-500',  text: 'text-green-400',  label: 'Healthy',    border: 'border-green-700/30',  bg: 'bg-green-900/10'  },
  yellow: { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'At Risk',    border: 'border-yellow-700/30', bg: 'bg-yellow-900/10' },
  red:    { dot: 'bg-red-500',    text: 'text-red-400',    label: 'Off Track',  border: 'border-red-700/30',    bg: 'bg-red-900/10'    },
  grey:   { dot: 'bg-slate-500',  text: 'text-slate-400',  label: 'No Activity', border: 'border-slate-700/30', bg: 'bg-slate-800/20'  },
};

// ── Milestone status icon ─────────────────────────────────────────────────────

function MilestoneIcon({ ms }: { ms: Milestone }) {
  if (ms.status === 'done')    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (ms.status === 'overdue') return <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (ms.status === 'next')    return <Clock className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-slate-600 shrink-0" />;
}

// ── ART Execution Card ────────────────────────────────────────────────────────

function ARTCard({
  team, currentQ, expanded, onToggle,
}: {
  team: Team;
  currentQ: Quarter;
  expanded: boolean;
  onToggle: () => void;
}) {
  const projects    = team.projects.nodes.filter((p) => p.state !== 'cancelled');
  const milestones  = milestonesInQuarter(team, currentQ);
  const health      = artHealth(projects);
  const hs          = ART_HEALTH[health];

  const active    = projects.filter((p) => p.state === 'started');
  const completed = projects.filter((p) => p.state === 'completed');
  const atRisk    = active.filter((p) => isOverdue(p) || isAtRisk(p));

  // Urgent issues surfaced from project issue lists
  const urgentIssues = projects.flatMap((p) =>
    p.issues.nodes.filter((i) => i.priority === 1 || i.priority === 2)
  ).slice(0, 5);

  // Next milestone to deliver
  const nextMs = milestones.find((m) => m.status !== 'done') ?? milestones[0] ?? null;
  const daysLeft = nextMs?.targetDate ? daysUntil(nextMs.targetDate) : null;

  return (
    <div className={cn('rounded-lg border overflow-hidden', hs.border, hs.bg)}>
      {/* ── Header row ── */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        {/* Team identity */}
        <div className="flex items-center gap-2.5 w-44 shrink-0">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-200 truncate">{team.name}</div>
            <div className="text-xs font-mono text-slate-500">{team.key}</div>
          </div>
        </div>

        {/* Next delivery */}
        <div className="flex-1 min-w-0">
          {nextMs ? (
            <div className="flex items-center gap-2">
              <MilestoneIcon ms={nextMs} />
              <span className="text-xs text-slate-300 truncate">{nextMs.name}</span>
              <span className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                daysLeft === null       ? 'bg-slate-800 text-slate-500' :
                daysLeft < 0           ? 'bg-red-900/60 text-red-300 border border-red-700' :
                daysLeft <= 14         ? 'bg-yellow-900/60 text-yellow-300 border border-yellow-700' :
                                         'bg-slate-800 text-slate-400 border border-slate-700'
              )}>
                {daysLeft === null ? '—' : daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-600 italic">No deliveries this quarter</span>
          )}
          {/* Mini progress strip */}
          {milestones.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              {milestones.map((ms) => (
                <div
                  key={ms.id}
                  className={cn(
                    'h-1 rounded-full flex-1',
                    ms.status === 'done'    ? 'bg-green-500' :
                    ms.status === 'overdue' ? 'bg-red-500' :
                    ms.status === 'next'    ? 'bg-blue-500' :
                                              'bg-slate-700'
                  )}
                  title={ms.name}
                />
              ))}
            </div>
          )}
        </div>

        {/* Feature counts */}
        <div className="flex items-center gap-4 shrink-0 text-center">
          <div>
            <div className="text-sm font-bold tabular-nums text-slate-200">{active.length}</div>
            <div className="text-xs text-slate-600">Active</div>
          </div>
          {atRisk.length > 0 && (
            <div>
              <div className="text-sm font-bold tabular-nums text-yellow-400">{atRisk.length}</div>
              <div className="text-xs text-slate-600">At Risk</div>
            </div>
          )}
          <div>
            <div className="text-sm font-bold tabular-nums text-green-400">{completed.length}</div>
            <div className="text-xs text-slate-600">Done</div>
          </div>
          {urgentIssues.length > 0 && (
            <div>
              <div className="text-sm font-bold tabular-nums text-red-400">{urgentIssues.length}</div>
              <div className="text-xs text-slate-600">Urgent</div>
            </div>
          )}
        </div>

        {/* ART health */}
        <div className="flex items-center gap-1.5 w-24 shrink-0">
          <span className={cn('h-2 w-2 rounded-full', hs.dot)} />
          <span className={cn('text-xs font-medium', hs.text)}>{hs.label}</span>
        </div>

        <div className="text-slate-600 shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-slate-700/30 grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-700/30">

          {/* Deliveries this quarter */}
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {currentQ.label} Deliveries
            </div>
            {milestones.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No milestones this quarter</p>
            ) : (
              <div className="flex flex-col gap-2">
                {milestones.map((ms) => {
                  const dl = ms.targetDate ? daysUntil(ms.targetDate) : null;
                  const pct = Math.round(ms.progress * 100);
                  return (
                    <div key={ms.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <MilestoneIcon ms={ms} />
                        <a
                          href={ms.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'group flex min-w-0 flex-1 items-center gap-1 text-xs truncate hover:text-blue-300 transition-colors',
                            ms.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'
                          )}
                        >
                          <span className="truncate">{ms.name}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </a>
                        <span className={cn(
                          'shrink-0 text-xs tabular-nums',
                          dl !== null && dl < 0 ? 'text-red-400' : 'text-slate-500'
                        )}>
                          {formatDate(ms.targetDate)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pl-5">
                        <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-yellow-500')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-slate-500 w-7 text-right">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Features / Projects */}
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Features
            </div>
            {projects.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No features</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {projects.map((p) => {
                  const over  = isOverdue(p);
                  const risk  = isAtRisk(p);
                  const pct   = Math.round(p.progress * 100);
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        p.state === 'completed' ? 'bg-green-500' :
                        over                    ? 'bg-red-500' :
                        risk                    ? 'bg-yellow-500' :
                        p.state === 'started'   ? 'bg-blue-500' : 'bg-slate-600'
                      )} />
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-300 hover:text-blue-300 transition-colors"
                      >
                        <span className="truncate">{p.name}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </a>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Impediments */}
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Impediments
              <span className="ml-1 text-slate-700 font-normal normal-case">(urgent + high priority)</span>
            </div>
            {urgentIssues.length === 0 ? (
              <p className="text-xs text-green-600">No urgent issues</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {urgentIssues.map((issue) => (
                  <div key={issue.id} className="flex items-center gap-2">
                    <Zap className={cn(
                      'h-3 w-3 shrink-0',
                      issue.priority === 1 ? 'text-red-400' : 'text-orange-400'
                    )} />
                    <span className="w-16 shrink-0 font-mono text-xs text-slate-600">{issue.identifier}</span>
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-300 hover:text-blue-300 transition-colors"
                    >
                      <span className="truncate">{issue.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Portfolio Board cell ──────────────────────────────────────────────────────

function BoardCell({
  team, q, isCurrent, expanded, onToggle,
}: {
  team: Team;
  q: Quarter;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const milestones = milestonesInQuarter(team, q);
  const done       = milestones.filter((m) => m.status === 'done').length;
  const overdue    = milestones.filter((m) => m.status === 'overdue').length;
  const total      = milestones.length;

  if (total === 0) {
    return (
      <td className={cn('px-3 py-3 text-center border-b border-slate-700/30', isCurrent && 'bg-blue-950/10')}>
        <span className="text-xs text-slate-700">—</span>
      </td>
    );
  }

  const health: ARTHealth = overdue > 0 ? 'red' : done === total ? 'green' : 'yellow';
  const hs = ART_HEALTH[health];

  return (
    <td className={cn(
      'px-3 py-2 border-b border-slate-700/30 align-top',
      isCurrent && 'bg-blue-950/10'
    )}>
      <button
        onClick={onToggle}
        className="w-full text-left hover:bg-white/5 rounded transition-colors p-1 -m-1"
      >
        {/* Summary line */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className={cn('h-2 w-2 rounded-full shrink-0', hs.dot)} />
          <span className="text-xs text-slate-300 font-medium tabular-nums">
            {done}/{total}
          </span>
          {overdue > 0 && (
            <span className="text-xs text-red-400">⚠ {overdue}</span>
          )}
          <span className="ml-auto text-slate-600">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </div>
        {/* Milestone dots */}
        <div className="flex gap-0.5">
          {milestones.map((ms) => (
            <div
              key={ms.id}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                ms.status === 'done'    ? 'bg-green-500' :
                ms.status === 'overdue' ? 'bg-red-500' :
                ms.status === 'next'    ? 'bg-blue-500' :
                                          'bg-slate-700'
              )}
              title={ms.name}
            />
          ))}
        </div>
      </button>
      {/* Expanded milestone list */}
      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-slate-700/30 pt-2">
          {milestones.map((ms) => (
            <div key={ms.id} className="flex items-center gap-1.5">
              <MilestoneIcon ms={ms} />
              <a
                href={ms.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'group flex min-w-0 items-center gap-1 text-xs truncate max-w-36 hover:text-blue-300 transition-colors',
                  ms.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'
                )}
              >
                <span className="truncate">{ms.name}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
              </a>
            </div>
          ))}
        </div>
      )}
    </td>
  );
}

// ── Portfolio Board view ──────────────────────────────────────────────────────

function PortfolioBoard({ teams, currentQ }: { teams: Team[]; currentQ: Quarter }) {
  const year     = currentQ.year;
  const quarters = quartersForYear(year);
  // Also show previous year Q4 if we're in Q1
  const prevQ4   = currentQ.q === 1 ? buildQuarter(4, year - 1) : null;
  const columns  = prevQ4 ? [prevQ4, ...quarters] : quarters;

  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());

  function toggleCell(teamId: string, qLabel: string) {
    const key = `${teamId}__${qLabel}`;
    setExpandedCells((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Summary row: count ARTs with milestones per quarter
  function quarterSummary(q: Quarter) {
    let total = 0, done = 0, overdue = 0;
    for (const team of teams) {
      const ms = milestonesInQuarter(team, q);
      total   += ms.length;
      done    += ms.filter((m) => m.status === 'done').length;
      overdue += ms.filter((m) => m.status === 'overdue').length;
    }
    return { total, done, overdue };
  }

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/40">
        <h2 className="text-sm font-semibold text-slate-200">Portfolio Board — {year}</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Milestones per ART per quarter · Click cells to expand delivery names
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 w-44">
                ART / Team
              </th>
              {columns.map((q) => {
                const isCurrent = sameQuarter(q, currentQ);
                const summary   = quarterSummary(q);
                return (
                  <th
                    key={q.label}
                    className={cn(
                      'px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center',
                      isCurrent
                        ? 'bg-blue-950/20 text-blue-400 border-x border-blue-800/40'
                        : 'text-slate-500'
                    )}
                  >
                    <div>{q.label}</div>
                    {isCurrent && (
                      <div className="text-xs font-normal normal-case text-blue-500/70 mt-0.5">
                        Current PI
                      </div>
                    )}
                    {summary.total > 0 && (
                      <div className={cn(
                        'text-xs font-normal normal-case mt-0.5',
                        summary.overdue > 0 ? 'text-red-400' : 'text-slate-600'
                      )}>
                        {summary.done}/{summary.total} done
                        {summary.overdue > 0 && ` · ${summary.overdue} overdue`}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="hover:bg-slate-800/20 transition-colors">
                {/* Team name */}
                <td className="px-4 py-3 border-b border-slate-700/30">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                    <div>
                      <div className="text-xs font-medium text-slate-200">{team.name}</div>
                      <div className="text-xs font-mono text-slate-600">{team.key}</div>
                    </div>
                  </div>
                </td>
                {/* Quarter cells */}
                {columns.map((q) => (
                  <BoardCell
                    key={q.label}
                    team={team}
                    q={q}
                    isCurrent={sameQuarter(q, currentQ)}
                    expanded={expandedCells.has(`${team.id}__${q.label}`)}
                    onToggle={() => toggleCell(team.id, q.label)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-700/30">
        {[
          { dot: 'bg-green-500',  label: 'Done'     },
          { dot: 'bg-blue-500',   label: 'In Progress' },
          { dot: 'bg-yellow-500', label: 'Upcoming' },
          { dot: 'bg-red-500',    label: 'Overdue'  },
          { dot: 'bg-slate-700',  label: 'Planned'  },
        ].map(({ dot, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', dot)} />
            <span className="text-xs text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summary stats bar ─────────────────────────────────────────────────────────

function SummaryBar({ teams, currentQ }: { teams: Team[]; currentQ: Quarter }) {
  const qProgress = Math.round(quarterProgress(currentQ) * 100);

  let milestonesTotal = 0, milestonesDone = 0, milestonesOverdue = 0;
  let artsActive = 0, artsAtRisk = 0;

  for (const team of teams) {
    const ms = milestonesInQuarter(team, currentQ);
    milestonesTotal   += ms.length;
    milestonesDone    += ms.filter((m) => m.status === 'done').length;
    milestonesOverdue += ms.filter((m) => m.status === 'overdue').length;
    const h = artHealth(team.projects.nodes);
    if (h !== 'grey') artsActive++;
    if (h === 'yellow' || h === 'red') artsAtRisk++;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {[
        { label: 'Quarter Progress', value: `${qProgress}%`,      color: 'text-blue-400'   },
        { label: 'PI Deliveries',    value: `${milestonesDone}/${milestonesTotal}`, color: milestonesDone === milestonesTotal && milestonesTotal > 0 ? 'text-green-400' : 'text-slate-200' },
        { label: 'Overdue',          value: milestonesOverdue,    color: milestonesOverdue > 0 ? 'text-red-400' : 'text-slate-200' },
        { label: 'ARTs Active',      value: artsActive,           color: 'text-slate-200'  },
        { label: 'ARTs At Risk',     value: artsAtRisk,           color: artsAtRisk > 0 ? 'text-yellow-400' : 'text-slate-200' },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
          <div className={cn('text-xl font-bold tabular-nums', color)}>{value}</div>
          <div className="text-xs text-slate-600">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SAFeDashboardPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tab, setTab] = useState<'art' | 'board'>('art');
  const [expandedARTs, setExpandedARTs] = useState<Set<string>>(new Set());

  const currentQ = useMemo(() => currentQuarter(), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolioWithMilestones();
      setTeams(data);
      setLastRefreshed(new Date());
      // Auto-expand ARTs with at-risk or overdue work
      const autoExpand = new Set<string>();
      for (const team of data) {
        if (team.projects.nodes.some((p) => isOverdue(p) || isAtRisk(p))) {
          autoExpand.add(team.id);
        }
      }
      setExpandedARTs(autoExpand);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleART(id: string) {
    setExpandedARTs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Target className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-blue-400">SAFe</span>
          </div>
          <h1 className="text-lg font-bold text-white">SAFe Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            ART execution · PI delivery tracking · Calendar year quarters
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-16 text-center text-sm text-slate-600">Loading PI data…</div>
      )}

      {teams && !loading && (
        <>
          {/* Current PI banner */}
          <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 px-4 py-3 flex items-center gap-4">
            <div>
              <div className="text-xs text-blue-500 uppercase tracking-wider font-semibold mb-0.5">Current Program Increment</div>
              <div className="text-lg font-bold text-blue-300">{currentQ.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {formatDate(currentQ.start.toISOString())} → {formatDate(currentQ.end.toISOString())}
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-500">Quarter progress</span>
                <span className="text-xs tabular-nums text-blue-400 font-medium">
                  {Math.round(quarterProgress(currentQ) * 100)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${Math.round(quarterProgress(currentQ) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <SummaryBar teams={teams} currentQ={currentQ} />

          {/* Tab switcher */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-md border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setTab('art')}
                className={cn(
                  'px-3 py-1.5 font-medium transition-colors',
                  tab === 'art' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400 hover:bg-slate-800'
                )}
              >
                ART Execution
              </button>
              <button
                onClick={() => setTab('board')}
                className={cn(
                  'px-3 py-1.5 font-medium transition-colors border-l border-slate-700',
                  tab === 'board' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400 hover:bg-slate-800'
                )}
              >
                Portfolio Board
              </button>
            </div>
            {tab === 'art' && (
              <div className="flex gap-2 ml-auto text-xs">
                <button
                  onClick={() => teams && setExpandedARTs(new Set(teams.map((t) => t.id)))}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Expand all
                </button>
                <span className="text-slate-700">·</span>
                <button
                  onClick={() => setExpandedARTs(new Set())}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Collapse all
                </button>
              </div>
            )}
          </div>

          {/* ART Execution view */}
          {tab === 'art' && (
            <div className="flex flex-col gap-3">
              {teams.map((team) => (
                <ARTCard
                  key={team.id}
                  team={team}
                  currentQ={currentQ}
                  expanded={expandedARTs.has(team.id)}
                  onToggle={() => toggleART(team.id)}
                />
              ))}
            </div>
          )}

          {/* Portfolio Board view */}
          {tab === 'board' && (
            <PortfolioBoard teams={teams} currentQ={currentQ} />
          )}

          {/* SAFe mapping note */}
          <div className="rounded-lg border border-slate-700/30 bg-slate-800/20 px-4 py-3 text-xs text-slate-600">
            <span className="font-medium text-slate-500">SAFe mapping:</span>{' '}
            Linear Teams → ARTs · Linear Projects → Features · Linear Milestones → PI Deliveries · Linear Issues → Stories
            <span className="ml-2">· Quarters: Jan–Mar (Q1) · Apr–Jun (Q2) · Jul–Sep (Q3) · Oct–Dec (Q4)</span>
          </div>
        </>
      )}
    </div>
  );
}
