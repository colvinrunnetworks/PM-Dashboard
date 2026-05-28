'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { GanttChart, Download, RefreshCw, Printer, CalendarRange, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GanttProject {
  id: string;
  name: string;
  state: string;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  lead: { name: string } | null;
}

interface GanttTeam {
  id: string;
  name: string;
  key: string;
  color: string;
  projects: { nodes: GanttProject[] };
}

// ── Milestone type ────────────────────────────────────────────────────────────

interface GanttMilestone {
  id: string;
  name: string;
  targetDate: string | null;
  status: 'unstarted' | 'next' | 'overdue' | 'done';
}

// ── Status colours ────────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, string> = {
  started:   '#2ecc71',
  planned:   '#3498db',
  paused:    '#bdc3c7',
  cancelled: '#bdc3c7',
  completed: '#7f8c8d',
};

const STATE_LABEL: Record<string, string> = {
  started:   'In Progress',
  planned:   'Planned',
  paused:    'On Hold',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

function stateColor(s: string) { return STATE_COLOR[s] ?? '#bdc3c7'; }
function stateLabel(s: string) { return STATE_LABEL[s] ?? s; }

// ── SDEAT use-case grouping ───────────────────────────────────────────────────

const SDE_USE_CASES: { name: string; terms: string[]; color: string }[] = [
  { name: 'UC1 — TIPC: Task Financial Planning & Management', terms: ['use case #1','tipc','1c)','1d)','1e)','1f)'], color: '#5c6bc0' },
  { name: 'UC2 — WLP: Workload Planning',                    terms: ['use case #2','wlp'],                          color: '#42a5f5' },
  { name: 'UC3 — ILS: Integrated Logistics Support',         terms: ['use case #3','ils'],                          color: '#ab47bc' },
  { name: 'UC4 — OOQ: Quality Assurance',                    terms: ['use case #4','ooq'],                          color: '#ec407a' },
  { name: 'UC5 — Fleet Tasking Management',                  terms: ['1g)','1h)'],                                  color: '#ff7043' },
  { name: 'UC6 — Funding Document Acceptance',               terms: ['1b)'],                                        color: '#26a69a' },
  { name: 'Program Management',                              terms: [],                                             color: '#78909c' },
];

function applyUseCaseGrouping(teams: GanttTeam[]): GanttTeam[] {
  // Only applies when a single SDE team is loaded
  if (teams.length !== 1 || teams[0].key !== 'SDE') return teams;

  const projects = teams[0].projects.nodes;
  const groups: GanttTeam[] = SDE_USE_CASES.map(uc => ({
    id:       uc.name,
    name:     uc.name,
    key:      'SDE',
    color:    uc.color,
    projects: { nodes: [] },
  }));
  const catchAll = groups[groups.length - 1];

  for (const p of projects) {
    const lower = p.name.toLowerCase();
    let placed = false;
    for (let i = 0; i < groups.length - 1; i++) {
      if (SDE_USE_CASES[i].terms.some(t => lower.includes(t))) {
        groups[i].projects.nodes.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) catchAll.projects.nodes.push(p);
  }

  // Sort each group by startDate asc (nulls last)
  for (const g of groups) {
    g.projects.nodes.sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });
  }

  return groups.filter(g => g.projects.nodes.length > 0);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseUTC(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00Z');
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', year: '2-digit', timeZone: 'UTC',
  });
}

// ── Range preset helpers ──────────────────────────────────────────────────────

type RangePreset = 'month' | 'quarter' | 'next-quarter' | 'year';

function presetRange(p: RangePreset): { start: string; end: string } {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = now.getMonth(); // 0-based
  const q    = Math.floor(m / 3);
  const pad  = (n: number) => String(n + 1).padStart(2, '0');

  switch (p) {
    case 'month':
      return { start: `${y}-${pad(m)}`, end: `${y}-${pad(m)}` };
    case 'quarter':
      return { start: `${y}-${pad(q * 3)}`, end: `${y}-${pad(q * 3 + 2)}` };
    case 'next-quarter': {
      const nq = q + 1;
      const ny = nq > 3 ? y + 1 : y;
      const nqn = nq % 4;
      return { start: `${ny}-${pad(nqn * 3)}`, end: `${ny}-${pad(nqn * 3 + 2)}` };
    }
    case 'year':
      return { start: `${y}-01`, end: `${y}-12` };
  }
}

function activePreset(range: { start: string; end: string } | null): RangePreset | null {
  if (!range) return null;
  for (const p of ['month', 'quarter', 'next-quarter', 'year'] as RangePreset[]) {
    const r = presetRange(p);
    if (r.start === range.start && r.end === range.end) return p;
  }
  return null;
}

// ── Bar position calculator ───────────────────────────────────────────────────

function makePositioner(minMs: number, totalMs: number) {
  return (d: Date) => ((d.getTime() - minMs) / totalMs) * 100;
}

// ── Gantt chart component ─────────────────────────────────────────────────────

const NAME_W = 260;

const MILESTONE_COLORS: Record<string, string> = {
  done:       '#22c55e',
  overdue:    '#ef4444',
  next:       '#3b82f6',
  unstarted:  '#94a3b8',
};

interface GanttViewProps {
  teams: GanttTeam[];
  milestoneMap: Map<string, GanttMilestone[]>;
  rangeOverride: { start: string; end: string } | null;
}

function GanttView({ teams, milestoneMap, rangeOverride }: GanttViewProps) {
  const { months, todayPct, pct, minDate, maxDate } = useMemo(() => {
    let minDate: Date;
    let maxDate: Date;

    if (rangeOverride) {
      const [sy, sm] = rangeOverride.start.split('-').map(Number);
      const [ey, em] = rangeOverride.end.split('-').map(Number);
      minDate = new Date(Date.UTC(sy, sm - 1, 1));
      maxDate = addMonthsUTC(new Date(Date.UTC(ey, em - 1, 1)), 1);
    } else {
      const allProjects = teams.flatMap(t => t.projects.nodes);
      const starts = allProjects.map(p => parseUTC(p.startDate)).filter(Boolean) as Date[];
      const ends   = allProjects.map(p => parseUTC(p.targetDate)).filter(Boolean) as Date[];
      if (!starts.length && !ends.length) return { months: [], todayPct: null, pct: null, minDate: null, maxDate: null };
      minDate = startOfMonthUTC(new Date(Math.min(...starts.map(d => d.getTime()))));
      maxDate = addMonthsUTC(new Date(Math.max(...ends.map(d => d.getTime()))), 1);
    }

    const totalMs = maxDate.getTime() - minDate.getTime();
    const pct     = makePositioner(minDate.getTime(), totalMs);

    const months: { label: string; left: number; width: number }[] = [];
    let cur = new Date(minDate);
    while (cur < maxDate) {
      const next = addMonthsUTC(cur, 1);
      months.push({ label: fmtMonth(cur), left: pct(cur), width: ((next.getTime() - cur.getTime()) / totalMs) * 100 });
      cur = next;
    }

    const now = new Date();
    const todayPct = now >= minDate && now <= maxDate ? pct(now) : null;
    return { months, todayPct, pct, minDate, maxDate };
  }, [teams, rangeOverride]);

  if (!pct || !minDate || !maxDate) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-6 py-12 text-center text-sm text-slate-500">
        No projects with dates found for this selection.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      {/* Sticky month header */}
      <div className="flex border-b border-slate-700/50 bg-slate-900/60 sticky top-0 z-10">
        <div className="shrink-0 border-r border-slate-700/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ width: NAME_W }}>
          Project
        </div>
        <div className="relative flex-1 h-8 overflow-hidden">
          {months.map(m => (
            <div key={m.label} className="absolute top-0 h-full border-l border-slate-700/40 px-1.5 flex items-center" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap overflow-hidden">{m.label}</span>
            </div>
          ))}
          {todayPct !== null && (
            <div className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10" style={{ left: `${todayPct}%` }} title="Today" />
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="overflow-x-auto">
        {teams.map(team => (
          <div key={team.id}>
            {/* Group / team header */}
            <div className="flex items-center border-b border-slate-700/30" style={{ backgroundColor: `${team.color}18` }}>
              <div className="shrink-0 flex items-center gap-2 border-r border-slate-700/40 px-3 py-2" style={{ width: NAME_W }}>
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                <span className="text-xs font-bold text-slate-200 truncate">{team.name}</span>
                {team.key !== team.name && (
                  <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-xs" style={{ color: team.color, backgroundColor: `${team.color}25` }}>
                    {team.key}
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-600 shrink-0">{team.projects.nodes.length}</span>
              </div>
              <div className="relative flex-1 h-9">
                {todayPct !== null && <div className="absolute top-0 bottom-0 w-px bg-red-500/30" style={{ left: `${todayPct}%` }} />}
              </div>
            </div>

            {team.projects.nodes.length === 0 && (
              <div className="flex border-b border-slate-700/20" style={{ minHeight: 32 }}>
                <div className="shrink-0 border-r border-slate-700/30 px-3 py-2 text-xs text-slate-600 italic" style={{ width: NAME_W }}>No projects</div>
                <div className="flex-1" />
              </div>
            )}

            {team.projects.nodes.map(project => {
              const s = parseUTC(project.startDate);
              const e = parseUTC(project.targetDate);
              const hasBar = s && e;
              const color  = stateColor(project.state);

              // Clamp bar to visible range
              const clampedLeft  = hasBar ? Math.max(0, pct(s!)) : 0;
              const clampedRight = hasBar ? Math.min(100, pct(e!)) : 0;
              const barWidth     = hasBar ? Math.max(0.3, clampedRight - clampedLeft) : 0;
              const barVisible   = hasBar && clampedRight > 0 && clampedLeft < 100;

              const milestones = milestoneMap.get(project.id) ?? [];

              return (
                <div key={project.id} className="flex border-b border-slate-700/20 hover:bg-slate-800/40 transition-colors" style={{ minHeight: 30 }}>
                  <div className="shrink-0 flex items-center gap-2 border-r border-slate-700/30 px-3 py-1.5" style={{ width: NAME_W }}>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} title={stateLabel(project.state)} />
                    <span className="text-xs text-slate-300 truncate" title={project.name}>{project.name}</span>
                  </div>
                  <div className="relative flex-1 flex items-center" style={{ minHeight: 30 }}>
                    {todayPct !== null && <div className="absolute top-0 bottom-0 w-px bg-red-500/20" style={{ left: `${todayPct}%` }} />}
                    {barVisible ? (
                      <div
                        className="absolute h-4 rounded flex items-center overflow-hidden"
                        style={{ left: `${clampedLeft}%`, width: `${barWidth}%`, backgroundColor: color, opacity: 0.85 }}
                        title={`${project.name}\n${fmtDate(project.startDate)} → ${fmtDate(project.targetDate)}\n${stateLabel(project.state)}`}
                      >
                        <div className="absolute inset-y-0 left-0 rounded opacity-40 bg-white" style={{ width: `${Math.round(project.progress * 100)}%` }} />
                        {barWidth >= 12 && (
                          <span
                            className="relative z-10 px-1.5 font-semibold whitespace-nowrap overflow-hidden"
                            style={{ fontSize: 9, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)' }}
                          >
                            {fmtDateShort(project.startDate)} → {fmtDateShort(project.targetDate)}
                          </span>
                        )}
                      </div>
                    ) : !hasBar ? (
                      <span className="px-3 text-xs text-slate-600 italic">No dates — Backlog</span>
                    ) : null}
                    {/* Milestone diamonds */}
                    {milestones.filter(m => m.targetDate).map(m => {
                      const mDate = parseUTC(m.targetDate);
                      if (!mDate) return null;
                      const mPct = pct(mDate);
                      if (mPct < 0 || mPct > 100) return null;
                      const mColor = MILESTONE_COLORS[m.status] ?? '#94a3b8';
                      return (
                        <div
                          key={m.id}
                          className="absolute z-10 cursor-default"
                          style={{
                            left: `calc(${mPct}% - 5px)`,
                            top: '50%',
                            width: 10, height: 10,
                            transform: 'translateY(-50%) rotate(45deg)',
                            backgroundColor: mColor,
                            border: '1.5px solid rgba(255,255,255,0.6)',
                            borderRadius: 1,
                          }}
                          title={`◆ ${m.name}\n${fmtDate(m.targetDate)}\n${m.status}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-slate-700/40 bg-slate-900/30 flex-wrap">
        {Object.entries(STATE_COLOR).filter(([k]) => k !== 'cancelled').map(([k, color]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-500">{STATE_LABEL[k]}</span>
          </div>
        ))}
        {todayPct !== null && (
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-0.5 bg-red-500/60 rounded" />
            <span className="text-xs text-slate-500">Today</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rotate-45 rounded-sm border border-white/40" style={{ backgroundColor: '#94a3b8' }} />
          <span className="text-xs text-slate-500">Milestone</span>
        </div>
        <span className="ml-auto text-xs text-slate-700">White fill = progress</span>
      </div>
    </div>
  );
}

// ── Export: HTML ──────────────────────────────────────────────────────────────

function generateExportHTML(
  teams: GanttTeam[],
  selectionLabel: string,
  rangeOverride: { start: string; end: string } | null = null,
): string {
  const today    = new Date();
  const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let minDate: Date;
  let maxDate: Date;

  if (rangeOverride) {
    const [sy, sm] = rangeOverride.start.split('-').map(Number);
    const [ey, em] = rangeOverride.end.split('-').map(Number);
    minDate = new Date(Date.UTC(sy, sm - 1, 1));
    maxDate = addMonthsUTC(new Date(Date.UTC(ey, em - 1, 1)), 1);
  } else {
    const allProjects = teams.flatMap(t => t.projects.nodes);
    const starts = allProjects.map(p => parseUTC(p.startDate)).filter(Boolean) as Date[];
    const ends   = allProjects.map(p => parseUTC(p.targetDate)).filter(Boolean) as Date[];
    if (!starts.length && !ends.length) return '<html><body><p>No projects with dates.</p></body></html>';
    minDate = startOfMonthUTC(new Date(Math.min(...starts.map(d => d.getTime()))));
    maxDate = addMonthsUTC(new Date(Math.max(...ends.map(d => d.getTime()))), 1);
  }

  // Filter teams to only projects overlapping the visible window
  const filteredTeams = teams.map(t => ({
    ...t,
    projects: {
      nodes: t.projects.nodes.filter(p => {
        const s = parseUTC(p.startDate);
        const e = parseUTC(p.targetDate);
        if (!s && !e) return !rangeOverride; // no-date projects: include in full export only
        const start = s ?? e!;
        const end   = e ?? s!;
        return start < maxDate && end >= minDate;
      }),
    },
  })).filter(t => t.projects.nodes.length > 0);

  const totalMs = maxDate.getTime() - minDate.getTime();
  const pct     = makePositioner(minDate.getTime(), totalMs);
  const rangeLabel = rangeOverride
    ? ` · ${fmtMonth(minDate)} – ${fmtMonth(addMonthsUTC(maxDate, -1))}`
    : '';

  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const next = addMonthsUTC(cur, 1);
    months.push({ label: fmtMonth(cur), left: pct(cur), width: ((next.getTime() - cur.getTime()) / totalMs) * 100 });
    cur = next;
  }

  const todayPct    = today >= minDate && today <= maxDate ? pct(today) : null;
  const esc         = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const todayLine   = (p: number) => `<div style="position:absolute;top:0;bottom:0;width:1px;background:#e74c3c88;left:${p.toFixed(3)}%;z-index:5;"></div>`;

  let rows = '';
  for (const team of filteredTeams) {
    rows += `<tr>
      <td colspan="2" style="padding:6px 10px;font-weight:700;font-size:11px;color:#fff;background:${team.color}cc;border-bottom:1px solid #555;">
        ${esc(team.name)}${team.key !== team.name ? ` <span style="opacity:.6;font-weight:400;">${esc(team.key)}</span>` : ''}
      </td>
    </tr>`;

    for (const p of team.projects.nodes) {
      const s = parseUTC(p.startDate);
      const e = parseUTC(p.targetDate);
      const color    = stateColor(p.state);
      const hasBar   = s && e;
      const barLeft  = hasBar ? Math.max(0, pct(s!)).toFixed(3) : '0';
      const barRight = hasBar ? Math.min(100, pct(e!)) : 0;
      const barWidth = hasBar ? Math.max(0.3, barRight - parseFloat(barLeft)).toFixed(3) : '0';
      const barVisible = hasBar && barRight > 0 && parseFloat(barLeft) < 100;

      rows += `<tr>
        <td style="width:260px;min-width:260px;max-width:260px;padding:3px 10px;font-size:10px;color:#ddd;border-right:1px solid #333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #2a2a2a;" title="${esc(p.name)}">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle;"></span>${esc(p.name)}
        </td>
        <td style="position:relative;border-bottom:1px solid #2a2a2a;">
          <div style="position:relative;height:16px;width:100%;">
            ${todayPct !== null ? todayLine(todayPct) : ''}
            ${barVisible
              ? `<div style="position:absolute;left:${barLeft}%;width:${barWidth}%;height:100%;background:${color};border-radius:2px;opacity:.85;display:flex;align-items:center;overflow:hidden;" title="${esc(p.name)} | ${fmtDate(p.startDate)} → ${fmtDate(p.targetDate)} | ${esc(stateLabel(p.state))}"><span style="font-size:8px;color:#fff;padding:0 4px;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.9);">${esc(fmtDateShort(p.startDate))} → ${esc(fmtDateShort(p.targetDate))}</span></div>`
              : !hasBar ? `<span style="font-size:9px;color:#555;font-style:italic;padding-left:8px;">No dates — Backlog</span>` : ''}
          </div>
        </td>
      </tr>`;
    }
  }

  const monthHeaders = months.map(m =>
    `<div style="position:absolute;left:${m.left.toFixed(3)}%;width:${m.width.toFixed(3)}%;border-left:1px solid #333;padding:3px 4px;font-size:9px;color:#888;white-space:nowrap;overflow:hidden;">${esc(m.label)}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Gantt — ${esc(selectionLabel)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:12px;background:#111;color:#ddd;padding:20px;}
h1{font-size:16px;font-weight:700;margin-bottom:3px;}
.meta{font-size:10px;color:#666;margin-bottom:14px;}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;align-items:center;}
.dot{width:10px;height:10px;border-radius:3px;}
table{width:100%;border-collapse:collapse;}
@media print{body{background:#fff;color:#000;padding:12px;}}
</style>
</head>
<body>
<h1>Program Gantt — ${esc(selectionLabel)}${esc(rangeLabel)}</h1>
<p class="meta">Generated: ${todayStr} &nbsp;·&nbsp; Source: Linear</p>
<div class="legend">
  ${Object.entries(STATE_COLOR).filter(([k])=>k!=='cancelled').map(([k,c])=>`<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:#999;"><span class="dot" style="background:${c};"></span>${STATE_LABEL[k]}</span>`).join('')}
  ${todayPct !== null ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:#999;"><span style="width:2px;height:12px;background:#e74c3c;display:inline-block;"></span>Today</span>' : ''}
</div>
<div style="display:flex;">
  <div style="width:260px;min-width:260px;flex-shrink:0;padding:4px 10px;font-size:9px;font-weight:700;color:#888;border-right:1px solid #333;border-bottom:2px solid #444;background:#1a1a1a;">PROJECT</div>
  <div style="flex:1;position:relative;height:22px;border-bottom:2px solid #444;background:#1a1a1a;overflow:hidden;">${monthHeaders}</div>
</div>
<table><tbody>${rows}</tbody></table>
</body>
</html>`;
}

// ── Export: plain text summary ────────────────────────────────────────────────

function generateExportTXT(
  teams: GanttTeam[],
  selectionLabel: string,
  rangeOverride: { start: string; end: string } | null = null,
): string {
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Filter to range if set
  let filteredTeams = teams;
  if (rangeOverride) {
    const [sy, sm] = rangeOverride.start.split('-').map(Number);
    const [ey, em] = rangeOverride.end.split('-').map(Number);
    const minDate = new Date(Date.UTC(sy, sm - 1, 1));
    const maxDate = addMonthsUTC(new Date(Date.UTC(ey, em - 1, 1)), 1);
    filteredTeams = teams.map(t => ({
      ...t,
      projects: {
        nodes: t.projects.nodes.filter(p => {
          const s = parseUTC(p.startDate);
          const e = parseUTC(p.targetDate);
          if (!s && !e) return false;
          return (s ?? e!) < maxDate && (e ?? s!) >= minDate;
        }),
      },
    })).filter(t => t.projects.nodes.length > 0);
  }

  const rangeNote = rangeOverride ? `  |  Range: ${rangeOverride.start} → ${rangeOverride.end}` : '';
  const lines = [
    `Program Schedule — ${selectionLabel}${rangeNote}`,
    `Generated: ${todayStr}  |  Source: Linear`,
    '',
    ['Group / Team', 'Project', 'Start', 'End', 'Status'].join('\t'),
    ['------------', '-------', '-----', '---', '------'].join('\t'),
  ];
  for (const team of filteredTeams) {
    for (const p of team.projects.nodes) {
      lines.push([team.name, p.name, p.startDate ?? '—', p.targetDate ?? '—', stateLabel(p.state)].join('\t'));
    }
  }
  return lines.join('\n');
}

// ── Download helper ───────────────────────────────────────────────────────────

function triggerDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface TeamMeta { id: string; name: string; key: string; color: string }

function toMonthValue(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

export default function GanttPage() {
  const [allTeamMeta, setAllTeamMeta] = useState<TeamMeta[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [rawTeams, setRawTeams]   = useState<GanttTeam[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);
  const [milestoneMap, setMilestoneMap] = useState<Map<string, GanttMilestone[]>>(new Map());
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  const load = useCallback(async (teamId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const ganttUrl = teamId ? `/api/gantt?teamId=${teamId}` : '/api/gantt';
      const [ganttRes, msRes] = await Promise.all([
        fetch(ganttUrl),
        fetch('/api/milestones'),
      ]);
      if (!ganttRes.ok) {
        const j = await ganttRes.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed: ${ganttRes.status}`);
      }
      const json = await ganttRes.json();
      const loaded: GanttTeam[] = json.teams ?? [];
      setRawTeams(loaded);
      if (!teamId && loaded.length > 0) {
        setAllTeamMeta(loaded.map(t => ({ id: t.id, name: t.name, key: t.key, color: t.color })));
      }

      // Build milestone map from /api/milestones response
      if (msRes.ok) {
        const msJson = await msRes.json();
        const nodes: Array<{ id: string; name: string; targetDate: string | null; status: string; project: { id: string } }> =
          msJson?.data?.projectMilestones?.nodes ?? [];
        const map = new Map<string, GanttMilestone[]>();
        for (const n of nodes) {
          const pid = n.project.id;
          if (!map.has(pid)) map.set(pid, []);
          map.get(pid)!.push({ id: n.id, name: n.name, targetDate: n.targetDate, status: n.status as GanttMilestone['status'] });
        }
        setMilestoneMap(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  function selectTeam(id: string | null) {
    setSelectedTeamId(id);
    load(id);
  }

  // Apply SDEAT use-case grouping when the SDE team is selected
  const teams = useMemo(() => applyUseCaseGrouping(rawTeams), [rawTeams]);

  // Auto-compute date range from all raw project dates
  const autoRange = useMemo(() => {
    const all = rawTeams.flatMap(t => t.projects.nodes);
    const starts = all.map(p => p.startDate).filter(Boolean) as string[];
    const ends   = all.map(p => p.targetDate).filter(Boolean) as string[];
    if (!starts.length && !ends.length) return null;
    const minMs = Math.min(...starts.map(s => new Date(s + 'T00:00:00Z').getTime()));
    const maxMs = Math.max(...ends.map(e => new Date(e + 'T00:00:00Z').getTime()));
    return { start: toMonthValue(new Date(minMs).toISOString()), end: toMonthValue(new Date(maxMs).toISOString()) };
  }, [rawTeams]);

  const rangeOverride = customRange;
  const displayRange  = customRange ?? autoRange;
  const rangeModified = customRange !== null;

  const selectionLabel = useMemo(() => {
    if (!selectedTeamId) return 'All Teams';
    return allTeamMeta.find(t => t.id === selectedTeamId)?.name ?? 'Selected Team';
  }, [selectedTeamId, allTeamMeta]);

  const dateSlug = new Date().toISOString().slice(0, 10);
  const nameSlug = selectionLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const totalProjects = rawTeams.reduce((n, t) => n + t.projects.nodes.length, 0);
  const withDates     = rawTeams.flatMap(t => t.projects.nodes).filter(p => p.startDate && p.targetDate).length;

  const rangeLabel = rangeOverride
    ? (() => {
        const [sy, sm] = rangeOverride.start.split('-').map(Number);
        const [ey, em] = rangeOverride.end.split('-').map(Number);
        const s = new Date(Date.UTC(sy, sm - 1, 1));
        const e = addMonthsUTC(new Date(Date.UTC(ey, em - 1, 1)), 1);
        return `${fmtMonth(s)} – ${fmtMonth(addMonthsUTC(e, -1))}`;
      })()
    : 'All dates';

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Print styles */}
      <style>{`
        @media print {
          .gantt-no-print { display: none !important; }
          .gantt-print-header { display: block !important; }
          body, html { background: white !important; color: black !important; }
          .gantt-chart-wrapper {
            background: white !important;
            color: #111 !important;
            border: 1px solid #e5e7eb !important;
            border-radius: 6px !important;
          }
          .gantt-chart-wrapper * {
            border-color: #e5e7eb !important;
          }
          .gantt-chart-wrapper .bg-slate-900\\/60,
          .gantt-chart-wrapper .bg-slate-800\\/30,
          .gantt-chart-wrapper .bg-slate-900\\/30 {
            background: #f9fafb !important;
          }
          .gantt-chart-wrapper .text-slate-300,
          .gantt-chart-wrapper .text-slate-200 { color: #111827 !important; }
          .gantt-chart-wrapper .text-slate-500,
          .gantt-chart-wrapper .text-slate-600 { color: #6b7280 !important; }
        }
        .gantt-print-header { display: none; }
      `}</style>

      {/* Print-only header */}
      <div className="gantt-print-header" style={{ marginBottom: 16, borderBottom: '2px solid #1e40af', paddingBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#1e40af', textTransform: 'uppercase', marginBottom: 2 }}>COLVIN RUN NETWORKS</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>Program Schedule — {selectionLabel}</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{rangeLabel} · Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>

      {/* Header */}
      <div className="gantt-no-print flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <GanttChart className="h-5 w-5 text-blue-400" />
            Gantt
          </h1>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${selectionLabel} · ${totalProjects} projects · ${withDates} with dates`}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-wrap">
          <button
            onClick={() => load(selectedTeamId)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={() => triggerDownload(generateExportHTML(teams, selectionLabel, rangeOverride), 'text/html;charset=utf-8', `gantt-${nameSlug}-${dateSlug}.html`)}
            disabled={loading || teams.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download HTML
          </button>
          <button
            onClick={() => window.print()}
            disabled={loading || teams.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* Team picker */}
      {allTeamMeta.length > 0 && (
        <div className="gantt-no-print flex flex-wrap gap-2">
          <button
            onClick={() => selectTeam(null)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              selectedTeamId === null
                ? 'bg-blue-600/30 text-blue-300 border-blue-600/50'
                : 'text-slate-400 border-slate-700 hover:bg-slate-800'
            )}
          >
            All Teams
          </button>
          {allTeamMeta.map(t => (
            <button
              key={t.id}
              onClick={() => selectTeam(t.id)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                selectedTeamId !== t.id && 'text-slate-400 border-slate-700 hover:bg-slate-800'
              )}
              style={selectedTeamId === t.id ? { backgroundColor: `${t.color}25`, borderColor: `${t.color}80`, color: t.color } : {}}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="gantt-no-print rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && teams.length === 0 && (
        <div className="gantt-no-print flex items-center justify-center py-24 text-sm text-slate-500">
          Loading Gantt data…
        </div>
      )}

      {/* Date range controls */}
      {autoRange && (
        <div className="gantt-no-print flex flex-col gap-2">
          {/* Preset chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            {([
              { id: 'month',        label: 'This Month' },
              { id: 'quarter',      label: 'This Quarter' },
              { id: 'next-quarter', label: 'Next Quarter' },
              { id: 'year',         label: 'This Year' },
            ] as { id: RangePreset; label: string }[]).map(({ id, label }) => {
              const isActive = activePreset(customRange) === id;
              return (
                <button
                  key={id}
                  onClick={() => setCustomRange(isActive ? null : presetRange(id))}
                  className={cn(
                    'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-blue-600/25 text-blue-300 border-blue-500/50'
                      : 'text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-200'
                  )}
                >
                  {label}
                </button>
              );
            })}
            {rangeModified && (
              <button
                onClick={() => setCustomRange(null)}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
          {/* Manual pickers */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 w-20">Custom range</span>
            <input
              type="month"
              value={displayRange?.start ?? ''}
              min={autoRange.start}
              max={displayRange?.end ?? autoRange.end}
              onChange={e => setCustomRange(r => ({ start: e.target.value, end: r?.end ?? autoRange!.end }))}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-slate-600">→</span>
            <input
              type="month"
              value={displayRange?.end ?? ''}
              min={displayRange?.start ?? autoRange.start}
              max={autoRange.end}
              onChange={e => setCustomRange(r => ({ start: r?.start ?? autoRange!.start, end: e.target.value }))}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* Chart */}
      {teams.length > 0 && (
        <div className="gantt-chart-wrapper">
          <GanttView teams={teams} milestoneMap={milestoneMap} rangeOverride={rangeOverride} />
        </div>
      )}
    </div>
  );
}
