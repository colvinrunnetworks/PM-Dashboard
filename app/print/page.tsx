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
    <div style={{ marginTop: 32, pageBreakBefore: 'always' }}>
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
                <div key={p.id} style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', minHeight: 22 }}>
                  <div style={{ width: GANTT_NAME_W, minWidth: GANTT_NAME_W, padding: '3px 8px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} title={gStateLabel(p.state)} />
                    <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</span>
                  </div>
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                    {todayPct !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef444418', left: `${todayPct}%` }} />}
                    {barVisible && (
                      <div style={{ position: 'absolute', left: `${barLeft}%`, width: `${barWidth}%`, height: 12, background: color, borderRadius: 2, opacity: 0.8 }} title={`${p.name} · ${gFmtDate(p.startDate)} → ${gFmtDate(p.targetDate)}`}>
                        <div style={{ position: 'absolute', inset: 0, borderRadius: 2, background: 'white', opacity: 0.35, width: `${Math.round(p.progress * 100)}%` }} />
                      </div>
                    )}
                    {!hasBar && <span style={{ fontSize: 9, color: '#d1d5db', fontStyle: 'italic', paddingLeft: 8 }}>No dates</span>}
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

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#fafafa' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function TeamHealthMatrix({ teams, riskItems }: { teams: Team[]; riskItems: RiskItem[] }) {
  const activeTeams = teams.filter(t => t.projects.nodes.some(p => p.state !== 'completed' && p.state !== 'cancelled'));
  if (activeTeams.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>Team Health</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af' }}>Team</th>
            {['Active', 'On Track', 'At Risk', 'Overdue', 'On Hold', 'Backlog Issues'].map(h => (
              <th key={h} style={{ padding: '5px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeTeams.map(team => {
            const projs = team.projects.nodes;
            const active    = projs.filter(p => p.state !== 'completed' && p.state !== 'cancelled').length;
            const onTrack   = projs.filter(p => p.state === 'started' && !isOverdue(p) && !isAtRisk(p)).length;
            const atRisk    = projs.filter(p => isAtRisk(p)).length;
            const overdue   = projs.filter(p => isOverdue(p)).length;
            const onHold    = projs.filter(p => p.state === 'paused').length;
            const backlog   = riskItems.filter(r => r.teamKey === team.key).reduce((s, r) => s + r.backlogCount, 0);
            return (
              <tr key={team.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: team.color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: '#111827' }}>{team.name}</span>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: team.color, backgroundColor: `${team.color}20`, padding: '1px 5px', borderRadius: 3 }}>{team.key}</span>
                </td>
                <Cell value={active}  neutral />
                <Cell value={onTrack} good={onTrack > 0} />
                <Cell value={atRisk}  warn={atRisk > 0} />
                <Cell value={overdue} bad={overdue > 0} />
                <Cell value={onHold}  neutral />
                <Cell value={backlog} warn={backlog > 10} bad={backlog > 25} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value, good, warn, bad, neutral }: { value: number; good?: boolean; warn?: boolean; bad?: boolean; neutral?: boolean }) {
  const color = bad ? '#dc2626' : warn ? '#d97706' : good ? '#16a34a' : '#374151';
  const bg    = bad ? '#fef2f2' : warn ? '#fffbeb' : good && value > 0 ? '#f0fdf4' : 'transparent';
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

function ProjectTableRow({ project, teamColor }: { project: Project; teamColor: string }) {
  const pct     = Math.round(project.progress * 100);
  const overdue = isOverdue(project);
  const atRisk  = isAtRisk(project);
  const statusStyle: React.CSSProperties = overdue ? { color: '#dc2626', fontWeight: 600 } : atRisk ? { color: '#d97706', fontWeight: 600 } : { color: '#374151' };
  return (
    <tr className="print-no-break" style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ width: 4, padding: 0, backgroundColor: teamColor }} />
      <td style={{ padding: '6px 8px', fontSize: 13, color: '#111827' }}>{project.name}</td>
      <td style={{ padding: '6px 8px', fontSize: 12, ...statusStyle }}>{statusText(project)}</td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>{healthText(project)}</td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 60, height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, backgroundColor: pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#eab308' : '#ef4444' }} />
          </div>
          <span style={{ whiteSpace: 'nowrap' }}>{pct}%</span>
        </div>
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: overdue ? '#dc2626' : '#374151', whiteSpace: 'nowrap' }}>{formatDate(project.targetDate)}</td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>{project.lead ? formatLeadName(project.lead.name) : '—'}</td>
      <td style={{ padding: '6px 8px', fontSize: 11, color: '#6b7280', maxWidth: 260 }}>{upcomingMilestones(project)}</td>
    </tr>
  );
}

function TeamSection({ team }: { team: Team }) {
  const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
  if (active.length === 0) return null;
  return (
    <div className="print-no-break" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `2px solid ${team.color}`, paddingBottom: 4, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: team.color, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{team.name}</span>
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: team.color, backgroundColor: `${team.color}20`, padding: '1px 6px', borderRadius: 3 }}>{team.key}</span>
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{active.length} active project{active.length !== 1 ? 's' : ''}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ width: 4, padding: 0 }} />
            {['Project', 'Status', 'PM Health', 'Progress', 'Target Date', 'Lead', 'Upcoming Milestones (90d)'].map(h => (
              <th key={h} style={{ padding: '5px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map(project => <ProjectTableRow key={project.id} project={project} teamColor={team.color} />)}
        </tbody>
      </table>
    </div>
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
      rows += `<div style="display:flex;border-bottom:1px solid #f3f4f6;min-height:22px;">
        <div style="width:220px;min-width:220px;padding:3px 8px;border-right:1px solid #e5e7eb;display:flex;align-items:center;gap:5px;overflow:hidden;">
          <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
          <span style="color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${esc(p.name)}</span>
        </div>
        <div style="flex:1;position:relative;display:flex;align-items:center;">
          ${todayPct !== null ? todayLine(todayPct) : ''}
          ${barVisible ? `<div style="position:absolute;left:${barLeft.toFixed(2)}%;width:${barWidth.toFixed(2)}%;height:12px;background:${color};border-radius:2px;opacity:.8;"><div style="position:absolute;inset:0;border-radius:2px;background:white;opacity:.35;width:${Math.round(p.progress*100)}%"></div></div>` : ''}
          ${!hasBar ? `<span style="font-size:9px;color:#d1d5db;font-style:italic;padding-left:8px">No dates</span>` : ''}
        </div>
      </div>`;
    }
  }

  const legendItems = Object.entries(GANTT_STATE_COLOR).filter(([k]) => k !== 'cancelled').map(([k,c]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#6b7280"><span style="width:8px;height:8px;border-radius:2px;background:${c};display:inline-block"></span>${GANTT_STATE_LABEL[k]}</span>`
  ).join('');

  return `<div style="margin-top:40px;page-break-before:always">
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

  const statTilesHtml = [
    { label: 'Active',    value: stats.active,    color: '#2563eb' },
    { label: 'On Track',  value: stats.onTrack,   color: '#16a34a' },
    { label: 'At Risk',   value: stats.atRisk,    color: '#d97706' },
    { label: 'Overdue',   value: stats.overdue,   color: '#dc2626' },
    { label: 'Completed', value: stats.completed, color: '#6b7280' },
  ].map(({ label, value, color }) => `
    <div style="flex:1;text-align:center;padding:12px 8px;border-radius:6px;border:1px solid #e5e7eb;background:#fafafa">
      <div style="font-size:28px;font-weight:700;color:${color};line-height:1">${value}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-top:4px">${label}</div>
    </div>`).join('');

  // Team health matrix
  const activeTeams = teams.filter(t => t.projects.nodes.some(p => p.state !== 'completed' && p.state !== 'cancelled'));
  const matrixRows = activeTeams.map(team => {
    const projs   = team.projects.nodes;
    const active  = projs.filter(p => p.state !== 'completed' && p.state !== 'cancelled').length;
    const onTrack = projs.filter(p => p.state === 'started' && !isOverdue(p) && !isAtRisk(p)).length;
    const atRisk  = projs.filter(p => isAtRisk(p)).length;
    const overdue = projs.filter(p => isOverdue(p)).length;
    const onHold  = projs.filter(p => p.state === 'paused').length;
    const backlog = riskItems.filter(r => r.teamKey === team.key).reduce((s, r) => s + r.backlogCount, 0);

    const cell = (v: number, badIf: boolean, warnIf: boolean, goodIf?: boolean) => {
      const color = badIf ? '#dc2626' : warnIf ? '#d97706' : goodIf ? '#16a34a' : '#374151';
      const bg    = badIf ? '#fef2f2' : warnIf ? '#fffbeb' : goodIf ? '#f0fdf4' : 'transparent';
      return `<td style="padding:6px 8px;text-align:center;color:${color};background:${bg};font-weight:${v > 0 && (badIf||warnIf||goodIf) ? 600 : 400}">${v > 0 ? v : '<span style="color:#d1d5db">—</span>'}</td>`;
    };

    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:6px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="width:8px;height:8px;border-radius:50%;background:${team.color};display:inline-block;flex-shrink:0"></span>
          <span style="font-weight:600;color:#111827">${esc(team.name)}</span>
          <span style="font-size:9px;font-family:monospace;color:${team.color};background:${team.color}20;padding:1px 5px;border-radius:3px">${esc(team.key)}</span>
        </div>
      </td>
      ${cell(active, false, false)}
      ${cell(onTrack, false, false, onTrack > 0)}
      ${cell(atRisk, false, atRisk > 0)}
      ${cell(overdue, overdue > 0, false)}
      ${cell(onHold, false, false)}
      ${cell(backlog, backlog > 25, backlog > 10)}
    </tr>`;
  }).join('');

  const matrixHtml = `
    <div style="margin-top:24px">
      <h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 8px">Team Health</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f3f4f6">
          <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af">Team</th>
          ${['Active','On Track','At Risk','Overdue','On Hold','Backlog Issues'].map(h=>`<th style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;white-space:nowrap">${h}</th>`).join('')}
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

  // ── Page 2: Project Detail ────────────────────────────────────────────────────
  const teamSections = teams.map(team => {
    const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
    if (active.length === 0) return '';
    const rows = active.map(project => {
      const pct = Math.round(project.progress * 100);
      const overdue = isOverdue(project);
      const atRisk  = isAtRisk(project);
      const statusColor = overdue ? '#dc2626' : atRisk ? '#d97706' : '#374151';
      const pgColor     = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#eab308' : '#ef4444';
      return `<tr style="border-bottom:1px solid #e5e7eb">
        <td style="width:4px;padding:0;background:${team.color}"></td>
        <td style="padding:6px 8px;font-size:13px;color:#111827">${esc(project.name)}</td>
        <td style="padding:6px 8px;font-size:12px;color:${statusColor};font-weight:${overdue||atRisk?600:400}">${esc(statusText(project))}</td>
        <td style="padding:6px 8px;font-size:12px;color:#374151">${esc(healthText(project))}</td>
        <td style="padding:6px 8px;font-size:12px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:60px;height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;flex-shrink:0"><div style="height:100%;width:${pct}%;border-radius:3px;background:${pgColor}"></div></div>
            <span style="white-space:nowrap;color:#374151">${pct}%</span>
          </div>
        </td>
        <td style="padding:6px 8px;font-size:12px;color:${overdue?'#dc2626':'#374151'};white-space:nowrap">${esc(formatDate(project.targetDate))}</td>
        <td style="padding:6px 8px;font-size:12px;color:#374151">${esc(project.lead ? formatLeadName(project.lead.name) : '—')}</td>
        <td style="padding:6px 8px;font-size:11px;color:#6b7280;max-width:260px">${esc(upcomingMilestones(project))}</td>
      </tr>`;
    }).join('');
    return `<div style="margin-bottom:24px;page-break-inside:avoid">
      <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid ${team.color};padding-bottom:4px;margin-bottom:8px">
        <span style="width:10px;height:10px;border-radius:50%;background:${team.color};flex-shrink:0;display:inline-block"></span>
        <span style="font-size:14px;font-weight:700;color:#111827">${esc(team.name)}</span>
        <span style="font-size:11px;font-weight:600;font-family:monospace;color:${team.color};background:${team.color}20;padding:1px 6px;border-radius:3px">${esc(team.key)}</span>
        <span style="font-size:11px;color:#6b7280;margin-left:auto">${active.length} active project${active.length !== 1 ? 's' : ''}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f3f4f6">
          <th style="width:4px;padding:0"></th>
          ${['Project','Status','PM Health','Progress','Target Date','Lead','Upcoming Milestones (90d)'].map(h=>`<th style="padding:5px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;white-space:nowrap">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

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
<div style="margin-top:40px;page-break-before:always">
  <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 4px">Project Detail</h2>
  <p style="font-size:11px;color:#6b7280;margin:0 0 20px">All active projects · Source: Linear</p>
  ${teamSections}
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
      <style>{`@media print { .no-print { display: none !important; } .print-no-break { page-break-inside: avoid; } }`}</style>

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
      <div style={{ padding: '24px 32px', backgroundColor: 'white', minHeight: 'calc(100vh - 53px)' }}>

        {/* Page 1: Executive Summary */}
        <div style={{ marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#1e40af', textTransform: 'uppercase', marginBottom: 2 }}>COLVIN RUN NETWORKS</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>SBIR Portfolio Report</h1>
          {generatedAt && <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>Generated {generatedAt}</p>}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280', fontSize: 14 }}>Loading portfolio data…</div>}
        {error   && <div style={{ textAlign: 'center', padding: '60px 0', color: '#dc2626', fontSize: 14 }}>Error: {error}</div>}

        {teams && !loading && (
          <>
            {/* Narrative */}
            <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, margin: '0 0 20px', padding: '12px 16px', background: '#f8fafc', borderLeft: '3px solid #1e40af', borderRadius: '0 4px 4px 0' }}>
              {buildNarrative(teams, riskItems, riskItems.reduce((s, i) => s + i.backlogCount, 0))}
            </p>

            {/* Stats tiles */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
              {[
                { label: 'Active',    value: computeStats(teams).active,    color: '#2563eb' },
                { label: 'On Track',  value: computeStats(teams).onTrack,   color: '#16a34a' },
                { label: 'At Risk',   value: computeStats(teams).atRisk,    color: '#d97706' },
                { label: 'Overdue',   value: computeStats(teams).overdue,   color: '#dc2626' },
                { label: 'Completed', value: computeStats(teams).completed, color: '#6b7280' },
              ].map(t => <StatTile key={t.label} {...t} />)}
            </div>

            {/* Team health matrix */}
            <TeamHealthMatrix teams={teams} riskItems={riskItems} />

            {/* Top risks */}
            <TopRisks items={riskItems} />

            {/* Page 2: Project Detail */}
            <div style={{ marginTop: 40, pageBreakBefore: 'always' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Project Detail</h2>
              <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 20 }}>All active projects · Source: Linear</p>
              {teams.map(team => <TeamSection key={team.id} team={team} />)}
            </div>

            {/* Page 3: Gantt */}
            {ganttTeams.length > 0 && (
              <GanttSection
                teams={ganttTeams}
                quarterStart={quarter.start}
                quarterEnd={quarter.end}
                quarterLabel={quarter.label}
              />
            )}

            {/* Footer */}
            <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid #e5e7eb', fontSize: 10, color: '#9ca3af', display: 'flex', justifyContent: 'space-between' }}>
              <span>Colvin Run Networks — SBIR PM Dashboard</span>
              <span>Data sourced from Linear · {generatedAt}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
