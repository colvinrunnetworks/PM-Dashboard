'use client';

import { useState, useEffect } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { fetchPortfolioWithMilestones, fetchBacklogByProject } from '@/lib/api';
import type { BacklogMap } from '@/lib/api';
import {
  computeStats,
  isOverdue,
  isAtRisk,
  daysUntil,
  statusLabel,
  formatDate,
  formatLeadName,
  formatTimestamp,
  healthLabel,
} from '@/lib/utils';
import type { Team, Project } from '@/lib/types';

// ── Quarter helper ────────────────────────────────────────────────────────────

function getCurrentQuarter(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3);
  const start = new Date(Date.UTC(year, q * 3, 1));
  const end   = new Date(Date.UTC(year, q * 3 + 3, 1)); // exclusive
  return { start, end, label: `Q${q + 1} ${year}` };
}

// ── Gantt types + helpers (light-theme inline chart) ─────────────────────────

interface PrintGanttProject {
  id: string; name: string; state: string;
  startDate: string | null; targetDate: string | null; progress: number;
}
interface PrintGanttTeam {
  id: string; name: string; key: string; color: string;
  projects: { nodes: PrintGanttProject[] };
}

const GANTT_STATE_COLOR: Record<string, string> = {
  started: '#16a34a', planned: '#2563eb', paused: '#9ca3af',
  cancelled: '#9ca3af', completed: '#6b7280',
};
const GANTT_STATE_LABEL: Record<string, string> = {
  started: 'In Progress', planned: 'Planned', paused: 'On Hold',
  cancelled: 'Cancelled', completed: 'Completed',
};
function gStateColor(s: string) { return GANTT_STATE_COLOR[s] ?? '#9ca3af'; }
function gStateLabel(s: string) { return GANTT_STATE_LABEL[s] ?? s; }

function gParseUTC(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00Z');
}
function gStartOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function gAddMonths(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function gFmtMonth(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function gFmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const GANTT_NAME_W = 220;

// Constrain Gantt to a fixed date window (current quarter + 2-week padding on each side)
function GanttSection({ teams, quarterStart, quarterEnd, quarterLabel }: {
  teams: PrintGanttTeam[];
  quarterStart: Date;
  quarterEnd: Date;
  quarterLabel: string;
}) {
  // Pad slightly so bars near the edge don't get cut off visually
  const minDate = gAddMonths(gStartOfMonth(quarterStart), 0); // quarter start
  const maxDate = quarterEnd; // exclusive quarter end = start of next quarter

  const totalMs = maxDate.getTime() - minDate.getTime();
  if (totalMs <= 0) return null;
  const pct = (d: Date) => ((d.getTime() - minDate.getTime()) / totalMs) * 100;

  // Only include projects that overlap this window
  const filteredTeams = teams.map(t => ({
    ...t,
    projects: {
      nodes: t.projects.nodes.filter(p => {
        const s = gParseUTC(p.startDate);
        const e = gParseUTC(p.targetDate);
        if (!s && !e) return false;
        const start = s ?? e!;
        const end   = e ?? s!;
        return start < maxDate && end >= minDate;
      }),
    },
  })).filter(t => t.projects.nodes.length > 0);

  if (filteredTeams.length === 0) return null;

  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const next = gAddMonths(cur, 1);
    months.push({ label: gFmtMonth(cur), left: pct(cur), width: ((next.getTime() - cur.getTime()) / totalMs) * 100 });
    cur = next;
  }

  const now = new Date();
  const todayPct = now >= minDate && now <= maxDate ? pct(now) : null;

  return (
    <div style={{ marginTop: 0 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Program Schedule</h2>
      <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>{quarterLabel} · Active projects only · Source: Linear</p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', fontSize: 11 }}>
        <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
          <div style={{ width: GANTT_NAME_W, minWidth: GANTT_NAME_W, padding: '4px 8px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', borderRight: '1px solid #e5e7eb' }}>
            Project
          </div>
          <div style={{ flex: 1, position: 'relative', height: 24, overflow: 'hidden' }}>
            {months.map(m => (
              <div key={m.label} style={{ position: 'absolute', left: `${m.left}%`, width: `${m.width}%`, top: 0, height: '100%', borderLeft: '1px solid #e5e7eb', padding: '4px 3px', overflow: 'hidden' }}>
                <span style={{ fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap' }}>{m.label}</span>
              </div>
            ))}
            {todayPct !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef4444', opacity: 0.6, left: `${todayPct}%` }} />}
          </div>
        </div>

        {filteredTeams.map(team => (
          <div key={team.id}>
            <div style={{ display: 'flex', background: `${team.color}12`, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ width: GANTT_NAME_W, minWidth: GANTT_NAME_W, padding: '4px 8px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: team.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontWeight: 700, color: '#111827', fontSize: 11 }}>{team.name}</span>
                {team.key !== team.name && <span style={{ fontSize: 9, fontFamily: 'monospace', color: team.color, marginLeft: 4 }}>{team.key}</span>}
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: 22 }}>
                {todayPct !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef444430', left: `${todayPct}%` }} />}
              </div>
            </div>
            {team.projects.nodes.map(p => {
              const s = gParseUTC(p.startDate);
              const e = gParseUTC(p.targetDate);
              const hasBar = s && e;
              const color  = gStateColor(p.state);
              const barLeft  = hasBar ? Math.max(0, pct(s!)) : 0;
              const barRight = hasBar ? Math.min(100, pct(e!)) : 0;
              const barWidth = hasBar ? Math.max(0.3, barRight - barLeft) : 0;
              const barVisible = hasBar && barRight > 0 && barLeft < 100;
              return (
                <div key={p.id} style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', minHeight: 38 }}>
                  <div style={{ width: GANTT_NAME_W, minWidth: GANTT_NAME_W, padding: '3px 8px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} title={gStateLabel(p.state)} />
                    <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</span>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    {todayPct !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef444418', left: `${todayPct}%` }} />}
                    {barVisible && (
                      <>
                        <div style={{ position: 'absolute', left: `${barLeft}%`, width: `${barWidth}%`, height: 12, top: 6, background: color, borderRadius: 2, opacity: 0.8 }} title={`${p.name} · ${gFmtDate(p.startDate)} → ${gFmtDate(p.targetDate)}`}>
                          <div style={{ position: 'absolute', inset: 0, borderRadius: 2, background: 'white', opacity: 0.35, width: `${Math.round(p.progress * 100)}%` }} />
                        </div>
                        <span style={{ position: 'absolute', left: `${barLeft}%`, top: 21, fontSize: 9, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                          {gFmtDate(p.startDate)}
                        </span>
                        <span style={{ position: 'absolute', left: `${barRight}%`, top: 21, fontSize: 9, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', pointerEvents: 'none', transform: 'translateX(-100%)' }}>
                          {gFmtDate(p.targetDate)}
                        </span>
                      </>
                    )}
                    {!hasBar && <span style={{ fontSize: 9, color: '#d1d5db', fontStyle: 'italic', paddingLeft: 8, position: 'absolute', top: 10 }}>No dates</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 16, padding: '6px 8px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', flexWrap: 'wrap' }}>
          {Object.entries(GANTT_STATE_COLOR).filter(([k]) => k !== 'cancelled').map(([k, c]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#6b7280' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
              {GANTT_STATE_LABEL[k]}
            </span>
          ))}
          {todayPct !== null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#6b7280' }}>
              <span style={{ width: 1, height: 10, background: '#ef4444', display: 'inline-block' }} />
              Today
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#d1d5db' }}>White fill = progress</span>
        </div>
      </div>
    </div>
  );
}

// ── Risk Register data model ───────────────────────────────────────────────────

interface RiskItem {
  projectId: string;
  projectName: string;
  teamName: string;
  teamColor: string;
  teamKey: string;
  flags: string[];
  severity: number;
  daysLeft: number | null;
  progress: number;
  lead: string | null;
  backlogCount: number;
}

const RISK_SEVERITY: Record<string, number> = {
  'Overdue': 0, 'At Risk': 1, 'Due Soon': 2, 'Stalled': 3,
  'On Hold': 4, 'No Deadline': 5, 'No Lead': 6, 'Health Not Set': 7, 'Backlog Issues': 8,
};

function buildRiskItems(teams: Team[], backlogMap: BacklogMap): RiskItem[] {
  const items: RiskItem[] = [];
  for (const team of teams) {
    for (const project of team.projects.nodes) {
      const isActive = project.state !== 'completed' && project.state !== 'cancelled';
      const flags: string[] = [];
      const days = project.targetDate ? daysUntil(project.targetDate) : null;
      const backlogCount = backlogMap[project.id]?.length ?? 0;

      if (isOverdue(project))     flags.push('Overdue');
      else if (isAtRisk(project)) flags.push('At Risk');
      else if (isActive && days !== null && days >= 0 && days <= 30 && project.progress < 0.5) flags.push('Due Soon');

      if (project.state === 'paused') flags.push('On Hold');
      if (project.state === 'started' && project.progress === 0 && project.startDate && daysUntil(project.startDate) < 0) flags.push('Stalled');
      if (isActive && !project.targetDate)     flags.push('No Deadline');
      if (isActive && !project.lead)           flags.push('No Lead');
      if (isActive && project.health === null) flags.push('Health Not Set');
      if (isActive && backlogCount > 0)        flags.push('Backlog Issues');

      if (flags.length > 0) {
        const severity = Math.min(...flags.map(f => RISK_SEVERITY[f] ?? 99));
        items.push({
          projectId: project.id, projectName: project.name,
          teamName: team.name, teamColor: team.color, teamKey: team.key,
          flags, severity, daysLeft: days,
          progress: project.progress,
          lead: project.lead ? formatLeadName(project.lead.name) : null,
          backlogCount,
        });
      }
    }
  }
  return items.sort((a, b) => a.severity - b.severity || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}

const FLAG_COLORS: Record<string, { bg: string; text: string }> = {
  'Overdue':        { bg: '#fef2f2', text: '#dc2626' },
  'At Risk':        { bg: '#fff7ed', text: '#d97706' },
  'Due Soon':       { bg: '#fefce8', text: '#ca8a04' },
  'Stalled':        { bg: '#faf5ff', text: '#7c3aed' },
  'On Hold':        { bg: '#eff6ff', text: '#2563eb' },
  'No Deadline':    { bg: '#f9fafb', text: '#6b7280' },
  'No Lead':        { bg: '#f9fafb', text: '#6b7280' },
  'Health Not Set': { bg: '#f9fafb', text: '#6b7280' },
  'Backlog Issues': { bg: '#fffbeb', text: '#b45309' },
};

function FlagPill({ flag }: { flag: string }) {
  const c = FLAG_COLORS[flag] ?? { bg: '#f3f4f6', text: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 10,
      fontSize: 9, fontWeight: 600, marginRight: 3, whiteSpace: 'nowrap',
      backgroundColor: c.bg, color: c.text,
    }}>{flag}</span>
  );
}

// ── Risk flag definitions for print ──────────────────────────────────────────

const RISK_FLAGS: { key: string; color: string }[] = [
  { key: 'Overdue',        color: '#dc2626' },
  { key: 'At Risk',        color: '#d97706' },
  { key: 'Due Soon',       color: '#ca8a04' },
  { key: 'Stalled',        color: '#7c3aed' },
  { key: 'On Hold',        color: '#2563eb' },
  { key: 'No Deadline',    color: '#6b7280' },
  { key: 'No Lead',        color: '#6b7280' },
  { key: 'Health Not Set', color: '#6b7280' },
  { key: 'Backlog Issues', color: '#b45309' },
];

function riskCounts(items: RiskItem[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items) for (const f of item.flags) map[f] = (map[f] ?? 0) + 1;
  return map;
}

// ── Page 1: Executive Summary ─────────────────────────────────────────────────

function buildNarrative(teams: Team[], riskItems: RiskItem[], totalBacklog: number): string {
  const stats = computeStats(teams);
  const parts: string[] = [];
  parts.push(`${stats.active} project${stats.active !== 1 ? 's' : ''} active across ${teams.filter(t => t.projects.nodes.some(p => p.state === 'started')).length} team${teams.length !== 1 ? 's' : ''}.`);
  if (stats.overdue > 0) parts.push(`${stats.overdue} overdue.`);
  if (stats.atRisk > 0)  parts.push(`${stats.atRisk} at risk.`);
  if (stats.overdue === 0 && stats.atRisk === 0) parts.push('No overdue or at-risk projects.');
  if (totalBacklog > 0)  parts.push(`${totalBacklog} unprioritized or triage issues across backlog.`);
  parts.push(`${stats.completed} completed to date.`);
  return parts.join('  ');
}

const RISK_FLAG_DESC: Record<string, string> = {
  'Overdue':        'Target date passed, work incomplete',
  'At Risk':        'PM flagged as at risk or off track',
  'Due Soon':       'Deadline within 30 days, <50% done',
  'Stalled':        'In Progress but no work logged yet',
  'On Hold':        'Paused — blocked or deprioritized',
  'No Deadline':    'Active project missing a target date',
  'No Lead':        'No DRI or PM assigned',
  'Health Not Set': 'PM has not submitted a status check-in',
  'Backlog Issues': 'Unprioritized issues need triage',
};

function RiskSummaryTiles({ items }: { items: RiskItem[] }) {
  const counts = riskCounts(items);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 8, marginBottom: 4 }}>
      {RISK_FLAGS.map(({ key, color }) => {
        const n = counts[key] ?? 0;
        return (
          <div key={key} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#fafafa' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: n > 0 ? color : '#d1d5db', lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4, lineHeight: 1.2 }}>{key}</div>
            <div style={{ fontSize: 8, color: '#9ca3af', marginTop: 3, lineHeight: 1.3 }}>{RISK_FLAG_DESC[key]}</div>
          </div>
        );
      })}
    </div>
  );
}

function TeamRiskMatrix({ teams, riskItems }: { teams: Team[]; riskItems: RiskItem[] }) {
  const activeTeams = teams.filter(t => t.projects.nodes.some(p => p.state !== 'completed' && p.state !== 'cancelled'));
  if (activeTeams.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>Risk by Team</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af' }}>Team</th>
            {RISK_FLAGS.map(({ key }) => (
              <th key={key} style={{ padding: '5px 6px', textAlign: 'center', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', whiteSpace: 'nowrap' }}>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeTeams.map(team => {
            const teamItems = riskItems.filter(r => r.teamKey === team.key);
            const counts    = riskCounts(teamItems);
            return (
              <tr key={team.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: team.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{team.name}</span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: team.color, backgroundColor: `${team.color}20`, padding: '1px 5px', borderRadius: 3 }}>{team.key}</span>
                  </div>
                </td>
                {RISK_FLAGS.map(({ key, color }) => {
                  const n = counts[key] ?? 0;
                  return <Cell key={key} value={n} bad={n > 0 && (key === 'Overdue')} warn={n > 0 && (key === 'At Risk' || key === 'Due Soon' || key === 'Stalled' || key === 'Backlog Issues')} neutral={n === 0 || key === 'On Hold' || key === 'No Deadline' || key === 'No Lead' || key === 'Health Not Set'} color={n > 0 ? color : undefined} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value, good, warn, bad, neutral, color: colorOverride }: { value: number; good?: boolean; warn?: boolean; bad?: boolean; neutral?: boolean; color?: string }) {
  const color = colorOverride ?? (bad ? '#dc2626' : warn ? '#d97706' : good ? '#16a34a' : '#374151');
  const bg    = bad && value > 0 ? '#fef2f2' : warn && value > 0 ? '#fffbeb' : good && value > 0 ? '#f0fdf4' : 'transparent';
  return (
    <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: value > 0 && !neutral ? 600 : 400, color, backgroundColor: bg }}>
      {value > 0 ? value : <span style={{ color: '#d1d5db' }}>—</span>}
    </td>
  );
}

function TopRisks({ items }: { items: RiskItem[] }) {
  const top = items.slice(0, 8);
  if (top.length === 0) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>
        Top Risks {items.length > 8 && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11, color: '#9ca3af' }}>(showing 8 of {items.length})</span>}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <tbody>
          {top.map((item, i) => {
            const isOv = item.flags.includes('Overdue');
            const isAR = item.flags.includes('At Risk');
            const daysTxt = item.daysLeft === null ? ''
              : isOv  ? `${Math.abs(item.daysLeft)}d overdue`
              : item.daysLeft === 0 ? 'Due today'
              : `${item.daysLeft}d left`;
            const daysColor = isOv ? '#dc2626' : isAR ? '#d97706' : '#6b7280';
            const worstFlag = item.flags[0];
            const pillC = FLAG_COLORS[worstFlag] ?? { bg: '#f3f4f6', text: '#374151' };
            return (
              <tr key={item.projectId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '5px 6px', width: 20, color: '#d1d5db', fontSize: 10, fontWeight: 600 }}>{i + 1}</td>
                <td style={{ padding: '5px 0', width: 4, backgroundColor: item.teamColor }} />
                <td style={{ padding: '5px 10px', color: '#111827', fontWeight: 500 }}>{item.projectName}</td>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: item.teamColor, backgroundColor: `${item.teamColor}20`, padding: '1px 5px', borderRadius: 3 }}>{item.teamKey}</span>
                </td>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, backgroundColor: pillC.bg, color: pillC.text }}>{worstFlag}</span>
                </td>
                <td style={{ padding: '5px 8px', color: daysColor, fontWeight: isOv || isAR ? 600 : 400, whiteSpace: 'nowrap', fontSize: 11 }}>{daysTxt}</td>
                <td style={{ padding: '5px 8px', color: '#9ca3af', fontSize: 11 }}>{item.lead ?? <span style={{ fontStyle: 'italic', color: '#d1d5db' }}>No lead</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page 2: Project Detail ────────────────────────────────────────────────────

function statusText(project: Project): string {
  if (isOverdue(project)) return 'Overdue';
  if (isAtRisk(project))  return 'At Risk';
  return statusLabel(project.state);
}

function healthText(project: Project): string {
  if (!project.health) return '—';
  return healthLabel(project.health);
}

function upcomingMilestones(project: Project): string {
  const nodes = project.projectMilestones?.nodes ?? [];
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  return nodes
    .filter(ms => ms.status !== 'done' && ms.targetDate && new Date(ms.targetDate) <= cutoff)
    .sort((a, b) => new Date(a.targetDate!).getTime() - new Date(b.targetDate!).getTime())
    .map(ms => `${ms.name} (${formatDate(ms.targetDate)})`)
    .join('; ') || '—';
}

// Burn rate: how far through the timeline vs how far through the work
function burnRate(project: Project): { elapsed: number; done: number; gap: number } | null {
  if (!project.startDate || !project.targetDate) return null;
  const start = new Date(project.startDate).getTime();
  const end   = new Date(project.targetDate).getTime();
  if (end <= start) return null;
  const elapsed = Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
  const done    = project.progress;
  return { elapsed, done, gap: elapsed - done };
}

// Sort severity: 0=overdue…5=planned
function projectSeverity(p: Project): number {
  if (isOverdue(p))  return 0;
  if (isAtRisk(p))   return 1;
  if (p.state === 'started' && p.targetDate && daysUntil(p.targetDate) <= 30 && p.progress < 0.5) return 2;
  if (p.state === 'started' && p.progress === 0 && p.startDate && daysUntil(p.startDate) < 0) return 3;
  if (p.state === 'paused')  return 4;
  return 5;
}

interface FlatProject { project: Project; team: Team }

function flattenAndSort(teams: Team[]): FlatProject[] {
  const seen = new Set<string>();
  const flat: FlatProject[] = [];
  for (const team of teams) {
    for (const project of team.projects.nodes) {
      if (project.state === 'completed' || project.state === 'cancelled') continue;
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      flat.push({ project, team });
    }
  }
  return flat.sort((a, b) => {
    const sd = projectSeverity(a.project) - projectSeverity(b.project);
    if (sd !== 0) return sd;
    return (daysUntil(a.project.targetDate ?? '') ?? 9999) - (daysUntil(b.project.targetDate ?? '') ?? 9999);
  });
}

// ── Data Quality Block ────────────────────────────────────────────────────────

function DataQualityBlock({ projects }: { projects: FlatProject[] }) {
  const missingHealth   = projects.filter(({ project: p }) => p.health === null).length;
  const missingDeadline = projects.filter(({ project: p }) => !p.targetDate).length;
  const missingLead     = projects.filter(({ project: p }) => !p.lead).length;
  const stalled         = projects.filter(({ project: p }) => p.state === 'started' && p.progress === 0 && p.startDate && daysUntil(p.startDate) < 0).length;
  const total           = projects.length;

  const items = [
    { label: 'Missing health status', count: missingHealth,   color: '#6b7280' },
    { label: 'Missing deadline',      count: missingDeadline, color: '#d97706' },
    { label: 'Missing lead',          count: missingLead,     color: '#d97706' },
    { label: 'Stalled (0% progress)', count: stalled,         color: '#7c3aed' },
  ].filter(i => i.count > 0);

  if (items.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 6, border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', marginBottom: 16 }}>
      <span style={{ fontSize: 14 }}>✓</span>
      <span style={{ fontSize: 12, color: '#15803d', fontWeight: 500 }}>All {total} active projects have complete data.</span>
    </div>
  );

  return (
    <div style={{ padding: '10px 16px', borderRadius: 6, border: '1px solid #fde68a', backgroundColor: '#fffbeb', marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>
        Data Quality <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9ca3af', fontSize: 11 }}>— {total} active projects</span>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {items.map(({ label, count, color }) => (
          <span key={label} style={{ fontSize: 12, color }}>
            <strong>{count}</strong> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Burn rate cell ────────────────────────────────────────────────────────────

function BurnRateCell({ project }: { project: Project }) {
  const br = burnRate(project);
  if (!br) return <td style={{ padding: '6px 8px', fontSize: 11, color: '#d1d5db', textAlign: 'center' }}>—</td>;

  const elapsedPct = Math.round(br.elapsed * 100);
  const donePct    = Math.round(br.done * 100);
  const gapPct     = Math.round(br.gap * 100);
  const color      = gapPct > 25 ? '#dc2626' : gapPct > 10 ? '#d97706' : '#16a34a';
  const bg         = gapPct > 25 ? '#fef2f2' : gapPct > 10 ? '#fffbeb' : 'transparent';

  return (
    <td style={{ padding: '5px 8px', textAlign: 'center', backgroundColor: bg }}>
      <div style={{ fontSize: 10, color: '#9ca3af' }}>{elapsedPct}% elapsed</div>
      <div style={{ fontSize: 11, fontWeight: 600, color }}>{donePct}% done</div>
      {gapPct > 10 && <div style={{ fontSize: 9, color, opacity: 0.8 }}>▲ {gapPct}% behind</div>}
    </td>
  );
}

// ── Flat project row ──────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, React.CSSProperties> = {
  'Overdue':  { backgroundColor: '#fef2f2', color: '#dc2626', fontWeight: 700 },
  'At Risk':  { backgroundColor: '#fff7ed', color: '#d97706', fontWeight: 700 },
  'Due Soon': { backgroundColor: '#fefce8', color: '#ca8a04', fontWeight: 600 },
  'Stalled':  { backgroundColor: '#faf5ff', color: '#7c3aed', fontWeight: 600 },
  'On Hold':  { backgroundColor: '#eff6ff', color: '#2563eb', fontWeight: 600 },
};

function FlatProjectRow({ project, team }: FlatProject) {
  const status = statusText(project);
  const pillStyle = STATUS_PILL[status] ?? { color: '#374151' };

  return (
    <tr className="print-no-break" style={{ borderBottom: '1px solid #f3f4f6' }}>
      {/* Team color bar */}
      <td style={{ width: 4, padding: 0, backgroundColor: team.color }} />
      {/* Team badge */}
      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: team.color, backgroundColor: `${team.color}20`, padding: '1px 5px', borderRadius: 3 }}>
          {team.key}
        </span>
      </td>
      {/* Project name */}
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#111827', fontWeight: 500 }}>{project.name}</td>
      {/* Status */}
      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, ...pillStyle }}>{status}</span>
      </td>
      {/* Burn rate */}
      <BurnRateCell project={project} />
      {/* Target date */}
      <td style={{ padding: '6px 8px', fontSize: 11, color: isOverdue(project) ? '#dc2626' : '#374151', whiteSpace: 'nowrap' }}>
        {formatDate(project.targetDate)}
      </td>
      {/* Lead */}
      <td style={{ padding: '6px 8px', fontSize: 11, color: project.lead ? '#374151' : '#d1d5db', fontStyle: project.lead ? 'normal' : 'italic' }}>
        {project.lead ? formatLeadName(project.lead.name) : 'No lead'}
      </td>
      {/* PM Health */}
      <td style={{ padding: '6px 8px', fontSize: 11, color: '#374151' }}>{healthText(project)}</td>
      {/* Milestones */}
      <td style={{ padding: '6px 8px', fontSize: 10, color: '#6b7280', maxWidth: 200 }}>{upcomingMilestones(project)}</td>
    </tr>
  );
}

function ProjectDetailSection({ teams }: { teams: Team[] }) {
  const flat = flattenAndSort(teams);
  if (flat.length === 0) return null;
  return (
    <>
      <DataQualityBlock projects={flat} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ width: 4, padding: 0 }} />
            {['Team', 'Project', 'Status', 'Burn Rate', 'Target Date', 'Lead', 'PM Health', 'Milestones (90d)'].map(h => (
              <th key={h} style={{ padding: '5px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flat.map(({ project, team }) => <FlatProjectRow key={project.id} project={project} team={team} />)}
        </tbody>
      </table>
    </>
  );
}

// ── Page 4: Portfolio Health ──────────────────────────────────────────────────

const PRIORITY_LABEL: Record<number, string> = { 0: 'None', 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };

interface TeamHygiene {
  team: Team;
  active: number;         // non-completed, non-cancelled
  withLead: number;
  withTargetDate: number;
  withStartDate: number;
  withHealth: number;
  withDescription: number;
  withPriority: number;   // priority != 0
  stuckInBacklog: number; // state=planned/paused AND startDate in the past
}

function buildTeamHygiene(teams: Team[]): TeamHygiene[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return teams.map(team => {
    const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
    const n = active.length;
    if (n === 0) return { team, active: 0, withLead: 0, withTargetDate: 0, withStartDate: 0, withHealth: 0, withDescription: 0, withPriority: 0, stuckInBacklog: 0 };

    return {
      team,
      active: n,
      withLead:        active.filter(p => p.lead).length,
      withTargetDate:  active.filter(p => p.targetDate).length,
      withStartDate:   active.filter(p => p.startDate).length,
      withHealth:      active.filter(p => p.health !== null).length,
      withDescription: active.filter(p => p.description && p.description.trim().length > 0).length,
      withPriority:    active.filter(p => p.priority !== 0).length,
      stuckInBacklog:  active.filter(p => {
        if (p.state !== 'planned' && p.state !== 'paused') return false;
        if (!p.startDate) return false;
        return new Date(p.startDate + 'T00:00:00Z') < today;
      }).length,
    };
  }).filter(h => h.active > 0);
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function HygieneCell({ n, total, warn = 60, bad = 40 }: { n: number; total: number; warn?: number; bad?: number }) {
  const p = pct(n, total);
  const color = p >= 80 ? '#16a34a' : p >= warn ? '#d97706' : p >= bad ? '#ea580c' : '#dc2626';
  const bg    = p >= 80 ? '#f0fdf4' : p >= warn ? '#fffbeb' : p >= bad ? '#fff7ed' : '#fef2f2';
  return (
    <td style={{ padding: '6px 8px', textAlign: 'center', backgroundColor: n === 0 ? 'transparent' : bg }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: n === 0 ? '#d1d5db' : color }}>{p}%</span>
      <span style={{ fontSize: 9, color: '#9ca3af', display: 'block' }}>{n}/{total}</span>
    </td>
  );
}

function StuckBadge({ count }: { count: number }) {
  if (count === 0) return <td style={{ padding: '6px 8px', textAlign: 'center', color: '#d1d5db', fontSize: 12 }}>—</td>;
  return (
    <td style={{ padding: '6px 8px', textAlign: 'center', backgroundColor: '#fef2f2' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{count}</span>
    </td>
  );
}

function PortfolioHealthSection({ teams }: { teams: Team[] }) {
  const hygiene = buildTeamHygiene(teams);
  if (hygiene.length === 0) return null;

  const totals = hygiene.reduce((acc, h) => ({
    active:          acc.active          + h.active,
    withLead:        acc.withLead        + h.withLead,
    withTargetDate:  acc.withTargetDate  + h.withTargetDate,
    withStartDate:   acc.withStartDate   + h.withStartDate,
    withHealth:      acc.withHealth      + h.withHealth,
    withDescription: acc.withDescription + h.withDescription,
    withPriority:    acc.withPriority    + h.withPriority,
    stuckInBacklog:  acc.stuckInBacklog  + h.stuckInBacklog,
  }), { active: 0, withLead: 0, withTargetDate: 0, withStartDate: 0, withHealth: 0, withDescription: 0, withPriority: 0, stuckInBacklog: 0 });

  const cols = ['Lead', 'Target Date', 'Start Date', 'PM Health', 'Description', 'Priority'];

  return (
    <>
      {/* Overall score bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Lead Coverage',    desc: 'Projects with a named DRI assigned',           n: totals.withLead,        color: '#2563eb' },
          { label: 'Target Dates',     desc: 'Projects with a delivery deadline set',         n: totals.withTargetDate,  color: '#16a34a' },
          { label: 'PM Health Set',    desc: 'Projects with an active health status update',  n: totals.withHealth,      color: '#7c3aed' },
          { label: 'Has Description',  desc: 'Projects with scope or objective documented',   n: totals.withDescription, color: '#d97706' },
          { label: 'Priority Set',     desc: 'Projects with Urgent / High / Normal priority', n: totals.withPriority,    color: '#dc2626' },
        ].map(({ label, desc, n, color }) => {
          const p = pct(n, totals.active);
          return (
            <div key={label} style={{ flex: 1, minWidth: 100, padding: '10px 14px', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#fafafa' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: p >= 80 ? '#16a34a' : p >= 60 ? '#d97706' : '#dc2626', lineHeight: 1 }}>{p}%</div>
              <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{label}</div>
              <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 3, lineHeight: 1.3 }}>{desc}</div>
              <div style={{ marginTop: 6, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb' }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${p}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Stuck definition callout */}
      {totals.stuckInBacklog > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fef2f2', marginBottom: 16 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{totals.stuckInBacklog} project{totals.stuckInBacklog !== 1 ? 's' : ''} stuck</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}> — Planned or On Hold with a start date already in the past. These projects have not been moved to In Progress and may be blocking downstream work.</span>
          </div>
        </div>
      )}

      {/* Per-team scorecard */}
      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 8px' }}>Team Scorecard</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af' }}>Team</th>
            <th style={{ padding: '5px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af' }}>Active</th>
            {cols.map(c => <th key={c} style={{ padding: '5px 8px', textAlign: 'center', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', whiteSpace: 'nowrap' }}>{c}</th>)}
            <th style={{ padding: '5px 8px', textAlign: 'center', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#dc2626', whiteSpace: 'nowrap' }}>Stuck</th>
          </tr>
        </thead>
        <tbody>
          {hygiene.map(h => (
            <tr key={h.team.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '6px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: h.team.color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{h.team.name}</span>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: h.team.color, backgroundColor: `${h.team.color}20`, padding: '1px 5px', borderRadius: 3 }}>{h.team.key}</span>
                </div>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#374151' }}>{h.active}</td>
              <HygieneCell n={h.withLead}        total={h.active} />
              <HygieneCell n={h.withTargetDate}  total={h.active} />
              <HygieneCell n={h.withStartDate}   total={h.active} />
              <HygieneCell n={h.withHealth}      total={h.active} />
              <HygieneCell n={h.withDescription} total={h.active} />
              <HygieneCell n={h.withPriority}    total={h.active} warn={40} bad={20} />
              <StuckBadge count={h.stuckInBacklog} />
            </tr>
          ))}
          {/* Portfolio totals row */}
          <tr style={{ borderTop: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
            <td style={{ padding: '6px 10px', fontWeight: 700, color: '#111827', fontSize: 12 }}>Portfolio Total</td>
            <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#111827' }}>{totals.active}</td>
            <HygieneCell n={totals.withLead}        total={totals.active} />
            <HygieneCell n={totals.withTargetDate}  total={totals.active} />
            <HygieneCell n={totals.withStartDate}   total={totals.active} />
            <HygieneCell n={totals.withHealth}      total={totals.active} />
            <HygieneCell n={totals.withDescription} total={totals.active} />
            <HygieneCell n={totals.withPriority}    total={totals.active} warn={40} bad={20} />
            <StuckBadge count={totals.stuckInBacklog} />
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 9, color: '#9ca3af' }}>
        Color key: <span style={{ color: '#16a34a', fontWeight: 600 }}>Green ≥80%</span> · <span style={{ color: '#d97706', fontWeight: 600 }}>Amber ≥60%</span> · <span style={{ color: '#ea580c', fontWeight: 600 }}>Orange ≥40%</span> · <span style={{ color: '#dc2626', fontWeight: 600 }}>Red &lt;40%</span> · Stuck = Planned/On Hold with start date in the past
      </div>
    </>
  );
}

// ── HTML export helpers ───────────────────────────────────────────────────────

function buildGanttHTMLSection(
  teams: PrintGanttTeam[],
  quarterStart: Date,
  quarterEnd: Date,
  quarterLabel: string,
  esc: (s: string) => string,
): string {
  const minDate  = quarterStart;
  const maxDate  = quarterEnd;
  const totalMs  = maxDate.getTime() - minDate.getTime();
  if (totalMs <= 0) return '';

  const pct = (d: Date) => ((d.getTime() - minDate.getTime()) / totalMs) * 100;

  const filteredTeams = teams.map(t => ({
    ...t,
    projects: {
      nodes: t.projects.nodes.filter(p => {
        const s = gParseUTC(p.startDate);
        const e = gParseUTC(p.targetDate);
        if (!s && !e) return false;
        return (s ?? e!) < maxDate && (e ?? s!) >= minDate;
      }),
    },
  })).filter(t => t.projects.nodes.length > 0);

  if (filteredTeams.length === 0) return '';

  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const next = gAddMonths(cur, 1);
    months.push({ label: gFmtMonth(cur), left: pct(cur), width: ((next.getTime() - cur.getTime()) / totalMs) * 100 });
    cur = next;
  }
  const now = new Date();
  const todayPct = now >= minDate && now <= maxDate ? pct(now) : null;
  const todayLine = (p: number) => `<div style="position:absolute;top:0;bottom:0;width:1px;background:#ef444460;left:${p.toFixed(2)}%"></div>`;
  const monthHeaders = months.map(m =>
    `<div style="position:absolute;left:${m.left.toFixed(2)}%;width:${m.width.toFixed(2)}%;top:0;height:100%;border-left:1px solid #e5e7eb;padding:4px 3px;overflow:hidden;"><span style="font-size:9px;color:#9ca3af;white-space:nowrap">${esc(m.label)}</span></div>`
  ).join('');

  let rows = '';
  for (const team of filteredTeams) {
    rows += `<div style="display:flex;background:${team.color}12;border-bottom:1px solid #e5e7eb;">
      <div style="width:220px;min-width:220px;padding:4px 8px;border-right:1px solid #e5e7eb;display:flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${team.color};display:inline-block;flex-shrink:0"></span>
        <span style="font-weight:700;color:#111827;font-size:11px">${esc(team.name)}</span>
      </div>
      <div style="flex:1;position:relative;min-height:22px">${todayPct !== null ? todayLine(todayPct) : ''}</div>
    </div>`;
    for (const p of team.projects.nodes) {
      const s = gParseUTC(p.startDate);
      const e = gParseUTC(p.targetDate);
      const hasBar    = s && e;
      const color     = gStateColor(p.state);
      const barLeft   = hasBar ? Math.max(0, pct(s!)) : 0;
      const barRight  = hasBar ? Math.min(100, pct(e!)) : 0;
      const barWidth  = hasBar ? Math.max(0.3, barRight - barLeft) : 0;
      const barVisible = hasBar && barRight > 0 && barLeft < 100;
      rows += `<div style="display:flex;border-bottom:1px solid #f3f4f6;min-height:38px;">
        <div style="width:220px;min-width:220px;padding:3px 8px;border-right:1px solid #e5e7eb;display:flex;align-items:center;gap:5px;overflow:hidden;">
          <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
          <span style="color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${esc(p.name)}</span>
        </div>
        <div style="flex:1;position:relative;">
          ${todayPct !== null ? todayLine(todayPct) : ''}
          ${barVisible
            ? `<div style="position:absolute;left:${barLeft.toFixed(2)}%;width:${barWidth.toFixed(2)}%;height:12px;top:6px;background:${color};border-radius:2px;opacity:.8;"><div style="position:absolute;inset:0;border-radius:2px;background:white;opacity:.35;width:${Math.round(p.progress*100)}%"></div></div>
               <span style="position:absolute;left:${barLeft.toFixed(2)}%;top:21px;font-size:9px;font-weight:700;color:#111827;white-space:nowrap">${esc(gFmtDate(p.startDate))}</span>
               <span style="position:absolute;left:${barRight.toFixed(2)}%;top:21px;font-size:9px;font-weight:700;color:#111827;white-space:nowrap;transform:translateX(-100%)">${esc(gFmtDate(p.targetDate))}</span>`
            : ''}
          ${!hasBar ? `<span style="font-size:9px;color:#d1d5db;font-style:italic;padding-left:8px;position:absolute;top:10px">No dates</span>` : ''}
        </div>
      </div>`;
    }
  }

  const legendItems = Object.entries(GANTT_STATE_COLOR).filter(([k]) => k !== 'cancelled').map(([k,c]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#6b7280"><span style="width:8px;height:8px;border-radius:2px;background:${c};display:inline-block"></span>${GANTT_STATE_LABEL[k]}</span>`
  ).join('');

  return `<div style="margin-top:40px;page-break-before:always;break-before:page">
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 4px">Program Schedule</h2>
  <p style="font-size:11px;color:#6b7280;margin:0 0 12px">${esc(quarterLabel)} · Active projects only · Source: Linear</p>
  <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;font-size:11px">
    <div style="display:flex;border-bottom:2px solid #e5e7eb;background:#f9fafb">
      <div style="width:220px;min-width:220px;padding:4px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;border-right:1px solid #e5e7eb">Project</div>
      <div style="flex:1;position:relative;height:24px;overflow:hidden">${monthHeaders}${todayPct !== null ? todayLine(todayPct) : ''}</div>
    </div>
    ${rows}
    <div style="display:flex;gap:16px;padding:6px 8px;border-top:1px solid #e5e7eb;background:#f9fafb;flex-wrap:wrap">
      ${legendItems}
      ${todayPct !== null ? '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#6b7280"><span style="width:1px;height:10px;background:#ef4444;display:inline-block"></span>Today</span>' : ''}
    </div>
  </div>
</div>`;
}

function generateReportHTML(
  teams: Team[],
  ganttTeams: PrintGanttTeam[],
  riskItems: RiskItem[],
  quarterStart: Date,
  quarterEnd: Date,
  quarterLabel: string,
  generatedAt: string,
): string {
  const esc = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const stats = computeStats(teams);

  // ── Page 1: Executive Summary ────────────────────────────────────────────────
  const narrative = buildNarrative(teams, riskItems, riskItems.reduce((s, i) => s + i.backlogCount, 0));

  // Risk summary tiles (9 categories)
  const counts = riskCounts(riskItems);
  const statTilesHtml = `<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:8px;margin-bottom:4px">
    ${RISK_FLAGS.map(({ key, color }) => {
      const n = counts[key] ?? 0;
      return `<div style="text-align:center;padding:10px 6px;border-radius:6px;border:1px solid #e5e7eb;background:#fafafa">
        <div style="font-size:26px;font-weight:700;color:${n > 0 ? color : '#d1d5db'};line-height:1">${n}</div>
        <div style="font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-top:4px;line-height:1.2">${esc(key)}</div>
      </div>`;
    }).join('')}
  </div>`;

  // Team risk matrix (9 flag columns)
  const activeTeams = teams.filter(t => t.projects.nodes.some(p => p.state !== 'completed' && p.state !== 'cancelled'));
  const matrixRows = activeTeams.map(team => {
    const teamItems = riskItems.filter(r => r.teamKey === team.key);
    const tc = riskCounts(teamItems);
    const cell = (key: string) => {
      const n = tc[key] ?? 0;
      const { color } = RISK_FLAGS.find(f => f.key === key)!;
      const isBad  = n > 0 && key === 'Overdue';
      const isWarn = n > 0 && ['At Risk','Due Soon','Stalled','Backlog Issues'].includes(key);
      const bg = isBad ? '#fef2f2' : isWarn ? '#fffbeb' : 'transparent';
      return `<td style="padding:5px 6px;text-align:center;color:${n > 0 ? color : '#d1d5db'};background:${bg};font-weight:${n > 0 ? 600 : 400}">${n > 0 ? n : '—'}</td>`;
    };
    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:6px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="width:8px;height:8px;border-radius:50%;background:${team.color};display:inline-block;flex-shrink:0"></span>
          <span style="font-weight:600;color:#111827;font-size:12px">${esc(team.name)}</span>
          <span style="font-size:9px;font-family:monospace;color:${team.color};background:${team.color}20;padding:1px 5px;border-radius:3px">${esc(team.key)}</span>
        </div>
      </td>
      ${RISK_FLAGS.map(({ key }) => cell(key)).join('')}
    </tr>`;
  }).join('');

  const matrixHtml = `
    <div style="margin-top:24px">
      <h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 8px">Risk by Team</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#f3f4f6">
          <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af">Team</th>
          ${RISK_FLAGS.map(({ key }) => `<th style="padding:5px 6px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af;white-space:nowrap">${esc(key)}</th>`).join('')}
        </tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>`;

  // Top risks
  const topN = riskItems.slice(0, 8);
  const topRisksHtml = topN.length === 0 ? '' : `
    <div style="margin-top:24px">
      <h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 8px">
        Top Risks${riskItems.length > 8 ? ` <span style="font-weight:400;font-size:11px;text-transform:none;letter-spacing:0;color:#9ca3af">(showing 8 of ${riskItems.length})</span>` : ''}
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <tbody>${topN.map((item, i) => {
          const isOv = item.flags.includes('Overdue');
          const isAR = item.flags.includes('At Risk');
          const daysTxt = item.daysLeft === null ? '' : isOv ? `${Math.abs(item.daysLeft)}d overdue` : item.daysLeft === 0 ? 'Due today' : `${item.daysLeft}d left`;
          const daysColor = isOv ? '#dc2626' : isAR ? '#d97706' : '#6b7280';
          const worstFlag = item.flags[0];
          const pillC = FLAG_COLORS[worstFlag] ?? { bg: '#f3f4f6', text: '#374151' };
          return `<tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:5px 6px;width:20px;color:#d1d5db;font-size:10px;font-weight:600">${i+1}</td>
            <td style="padding:5px 0;width:4px;background:${item.teamColor}"></td>
            <td style="padding:5px 10px;color:#111827;font-weight:500">${esc(item.projectName)}</td>
            <td style="padding:5px 8px;white-space:nowrap"><span style="font-size:9px;font-family:monospace;color:${item.teamColor};background:${item.teamColor}20;padding:1px 5px;border-radius:3px">${esc(item.teamKey)}</span></td>
            <td style="padding:5px 8px;white-space:nowrap"><span style="padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700;background:${pillC.bg};color:${pillC.text}">${esc(worstFlag)}</span></td>
            <td style="padding:5px 8px;color:${daysColor};font-weight:${isOv||isAR?600:400};white-space:nowrap">${esc(daysTxt)}</td>
            <td style="padding:5px 8px;color:#9ca3af">${esc(item.lead ?? '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  // ── Page 2: Project Detail (flat sorted, exception-first) ────────────────────
  const flat = flattenAndSort(teams);

  // Data quality callout
  const missingHealth   = flat.filter(({ project: p }) => p.health === null).length;
  const missingDeadline = flat.filter(({ project: p }) => !p.targetDate).length;
  const missingLead     = flat.filter(({ project: p }) => !p.lead).length;
  const stalledCount    = flat.filter(({ project: p }) => p.state === 'started' && p.progress === 0 && p.startDate && daysUntil(p.startDate) < 0).length;
  const dqItems = [
    { label: 'missing health status', count: missingHealth,   color: '#6b7280' },
    { label: 'missing deadline',      count: missingDeadline, color: '#d97706' },
    { label: 'missing lead',          count: missingLead,     color: '#d97706' },
    { label: 'stalled (0% progress)', count: stalledCount,    color: '#7c3aed' },
  ].filter(i => i.count > 0);

  const dqHtml = dqItems.length === 0
    ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:6px;border:1px solid #bbf7d0;background:#f0fdf4;margin-bottom:16px">
        <span style="font-size:14px">✓</span>
        <span style="font-size:12px;color:#15803d;font-weight:500">All ${flat.length} active projects have complete data.</span>
       </div>`
    : `<div style="padding:10px 16px;border-radius:6px;border:1px solid #fde68a;background:#fffbeb;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#92400e;margin-bottom:8px">Data Quality — ${flat.length} active projects</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">${dqItems.map(({ label, count, color }) => `<span style="font-size:12px;color:${color}"><strong>${count}</strong> ${label}</span>`).join('')}</div>
       </div>`;

  const STATUS_PILL_HTML: Record<string, string> = {
    'Overdue':  'background:#fef2f2;color:#dc2626;font-weight:700',
    'At Risk':  'background:#fff7ed;color:#d97706;font-weight:700',
    'Due Soon': 'background:#fefce8;color:#ca8a04;font-weight:600',
    'Stalled':  'background:#faf5ff;color:#7c3aed;font-weight:600',
    'On Hold':  'background:#eff6ff;color:#2563eb;font-weight:600',
  };

  const flatRows = flat.map(({ project, team }) => {
    const status = statusText(project);
    const pillStyle = STATUS_PILL_HTML[status] ?? 'color:#374151';
    const overdue = isOverdue(project);

    // Burn rate cell
    const br = burnRate(project);
    let brCell = `<td style="padding:6px 8px;font-size:11px;color:#d1d5db;text-align:center">—</td>`;
    if (br) {
      const elapsedPct = Math.round(br.elapsed * 100);
      const donePct    = Math.round(br.done * 100);
      const gapPct     = Math.round(br.gap * 100);
      const color      = gapPct > 25 ? '#dc2626' : gapPct > 10 ? '#d97706' : '#16a34a';
      const bg         = gapPct > 25 ? '#fef2f2'  : gapPct > 10 ? '#fffbeb'  : 'transparent';
      brCell = `<td style="padding:5px 8px;text-align:center;background:${bg}">
        <div style="font-size:10px;color:#9ca3af">${elapsedPct}% elapsed</div>
        <div style="font-size:11px;font-weight:600;color:${color}">${donePct}% done</div>
        ${gapPct > 10 ? `<div style="font-size:9px;color:${color};opacity:.8">▲ ${gapPct}% behind</div>` : ''}
      </td>`;
    }

    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="width:4px;padding:0;background:${team.color}"></td>
      <td style="padding:5px 8px;white-space:nowrap"><span style="font-size:9px;font-family:monospace;color:${team.color};background:${team.color}20;padding:1px 5px;border-radius:3px">${esc(team.key)}</span></td>
      <td style="padding:6px 8px;font-size:12px;color:#111827;font-weight:500">${esc(project.name)}</td>
      <td style="padding:5px 8px;white-space:nowrap"><span style="padding:2px 8px;border-radius:10px;font-size:10px;${pillStyle}">${esc(status)}</span></td>
      ${brCell}
      <td style="padding:6px 8px;font-size:11px;color:${overdue?'#dc2626':'#374151'};white-space:nowrap">${esc(formatDate(project.targetDate))}</td>
      <td style="padding:6px 8px;font-size:11px;color:${project.lead?'#374151':'#d1d5db'};font-style:${project.lead?'normal':'italic'}">${esc(project.lead ? formatLeadName(project.lead.name) : 'No lead')}</td>
      <td style="padding:6px 8px;font-size:11px;color:#374151">${esc(healthText(project))}</td>
      <td style="padding:6px 8px;font-size:10px;color:#6b7280;max-width:200px">${esc(upcomingMilestones(project))}</td>
    </tr>`;
  }).join('');

  const flatTableHtml = flat.length === 0 ? '' : `
    ${dqHtml}
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f3f4f6">
        <th style="width:4px;padding:0"></th>
        ${['Team','Project','Status','Burn Rate','Target Date','Lead','PM Health','Milestones (90d)'].map(h => `<th style="padding:5px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;white-space:nowrap">${esc(h)}</th>`).join('')}
      </tr></thead>
      <tbody>${flatRows}</tbody>
    </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SBIR Portfolio Report — ${esc(generatedAt)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;}
body{font-family:system-ui,'Segoe UI',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:32px;max-width:1200px;margin:0 auto;}
@media print{@page{margin:1.5cm;size:A4 landscape;}body{padding:0;}}
</style>
</head>
<body>

<!-- Page 1: Executive Summary -->
<div style="margin-bottom:20px;border-bottom:2px solid #1e40af;padding-bottom:12px">
  <div style="font-size:9px;font-weight:700;letter-spacing:.15em;color:#1e40af;text-transform:uppercase;margin-bottom:2px">COLVIN RUN NETWORKS</div>
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0">SBIR Portfolio Report</h1>
  <p style="font-size:11px;color:#6b7280;margin:4px 0 0">Generated ${esc(generatedAt)}</p>
</div>
<p style="font-size:12px;color:#374151;line-height:1.6;margin:0 0 20px;padding:12px 16px;background:#f8fafc;border-left:3px solid #1e40af;border-radius:0 4px 4px 0">${esc(narrative)}</p>
<div style="display:flex;gap:12px;margin-bottom:4px">${statTilesHtml}</div>
${matrixHtml}
${topRisksHtml}

<!-- Page 2: Project Detail -->
<div style="margin-top:40px;page-break-before:always;break-before:page">
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 4px">Project Detail</h2>
  <p style="font-size:11px;color:#6b7280;margin:0 0 12px">Active projects sorted by severity · Source: Linear</p>
  ${flatTableHtml}
</div>

${buildGanttHTMLSection(ganttTeams, quarterStart, quarterEnd, quarterLabel, esc)}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between">
  <span>Colvin Run Networks — SBIR PM Dashboard</span>
  <span>Data sourced from Linear · ${esc(generatedAt)}</span>
</div>
</body>
</html>`;
}

function triggerDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PrintPage() {
  const [teams, setTeams]         = useState<Team[] | null>(null);
  const [ganttTeams, setGanttTeams] = useState<PrintGanttTeam[]>([]);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>('');

  const quarter = getCurrentQuarter();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [portfolioData, ganttRes, backlogMap] = await Promise.all([
        fetchPortfolioWithMilestones(),
        fetch('/api/gantt'),
        fetchBacklogByProject(),
      ]);
      setTeams(portfolioData);
      setRiskItems(buildRiskItems(portfolioData, backlogMap));
      if (ganttRes.ok) {
        const ganttJson = await ganttRes.json();
        setGanttTeams(ganttJson.teams ?? []);
      }
      setGeneratedAt(formatTimestamp(new Date()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const dateSlug = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* Toolbar */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 10,
        backgroundColor: '#1e293b', borderBottom: '1px solid #334155',
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>
          Portfolio Report Preview
        </span>
        {generatedAt && <span style={{ fontSize: 12, color: '#64748b' }}>Data as of {generatedAt}</span>}
        <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, backgroundColor: '#334155', color: '#cbd5e1', border: '1px solid #475569', cursor: loading ? 'not-allowed' : 'pointer' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          onClick={() => teams && triggerDownload(generateReportHTML(teams, ganttTeams, riskItems, quarter.start, quarter.end, quarter.label, generatedAt), 'text/html;charset=utf-8', `sbir-portfolio-report-${dateSlug}.html`)}
          disabled={loading || !!error || !teams}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, backgroundColor: '#334155', color: '#cbd5e1', border: '1px solid #475569', cursor: loading || error || !teams ? 'not-allowed' : 'pointer', opacity: loading || error || !teams ? 0.5 : 1 }}
        >
          <Printer size={13} />
          Download HTML
        </button>
        <button
          onClick={() => window.print()}
          disabled={loading || !!error}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, backgroundColor: '#2563eb', color: 'white', border: 'none', cursor: loading || error ? 'not-allowed' : 'pointer', opacity: loading || error ? 0.5 : 1 }}
        >
          <Printer size={13} />
          Print / PDF
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 32px', backgroundColor: '#e2e8f0', minHeight: 'calc(100vh - 53px)' }}>
        <style>{`
          .page-card {
            background: white;
            border-radius: 4px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12);
            padding: 32px;
          }
          .page-divider {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 0;
            color: #94a3b8;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .page-divider::before, .page-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: #cbd5e1;
          }
        `}</style>

        {/* Page 1: Portfolio Health */}
        <div className="page-card print-page">
          <div style={{ marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#1e40af', textTransform: 'uppercase', marginBottom: 2 }}>COLVIN RUN NETWORKS</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>SBIR Portfolio Report</h1>
            {generatedAt && <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>Generated {generatedAt}</p>}
          </div>

          {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280', fontSize: 14 }}>Loading portfolio data…</div>}
          {error   && <div style={{ textAlign: 'center', padding: '60px 0', color: '#dc2626', fontSize: 14 }}>Error: {error}</div>}

          {teams && !loading && (
            <>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Portfolio Health</h2>
              <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>Data hygiene scorecard across all active projects · Source: Linear</p>
              <PortfolioHealthSection teams={teams} />
            </>
          )}
        </div>

        {teams && !loading && (
          <>
            {/* Page break indicator */}
            <div className="no-print page-divider">Page 2 — Executive Summary</div>

            {/* Page 2: Executive Summary */}
            <div className="page-card print-page">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Executive Summary</h2>
              <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, margin: '0 0 20px', padding: '12px 16px', background: '#f8fafc', borderLeft: '3px solid #1e40af', borderRadius: '0 4px 4px 0' }}>
                {buildNarrative(teams, riskItems, riskItems.reduce((s, i) => s + i.backlogCount, 0))}
              </p>
              <RiskSummaryTiles items={riskItems} />
              <TeamRiskMatrix teams={teams} riskItems={riskItems} />
              <TopRisks items={riskItems} />
            </div>

            {/* Page break indicator */}
            <div className="no-print page-divider">Page 3 — Project Detail</div>

            {/* Page 3: Project Detail */}
            <div className="page-card print-page">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Project Detail</h2>
              <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>Active projects sorted by severity · Source: Linear</p>
              <ProjectDetailSection teams={teams} />
            </div>

            {/* Page break indicator */}
            {ganttTeams.length > 0 && (
              <div className="no-print page-divider">Page 4 — Program Schedule ({quarter.label})</div>
            )}

            {/* Page 4: Gantt */}
            {ganttTeams.length > 0 && (
              <div className="page-card">
                <GanttSection
                  teams={ganttTeams}
                  quarterStart={quarter.start}
                  quarterEnd={quarter.end}
                  quarterLabel={quarter.label}
                />
              </div>
            )}

            {/* Footer — screen only */}
            <div className="no-print" style={{ padding: '12px 0', fontSize: 10, color: '#94a3b8', textAlign: 'center' }}>
              Colvin Run Networks · SBIR PM Dashboard · Data sourced from Linear · {generatedAt}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
