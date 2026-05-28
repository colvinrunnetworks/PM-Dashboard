'use client';

import { useState, useEffect } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { fetchPortfolioWithMilestones } from '@/lib/api';
import {
  computeStats,
  isOverdue,
  isAtRisk,
  statusLabel,
  formatDate,
  formatLeadName,
  formatTimestamp,
  healthLabel,
} from '@/lib/utils';
import type { Team, Project } from '@/lib/types';

// ── Print-friendly status text (no Tailwind color classes) ──────────────────

function statusText(project: Project): string {
  if (isOverdue(project)) return 'Overdue';
  if (isAtRisk(project))  return 'At Risk';
  return statusLabel(project.state);
}

function healthText(project: Project): string {
  if (!project.health) return '—';
  return healthLabel(project.health);
}

// ── Upcoming milestones for a project (next 90d, not done) ──────────────────

function upcomingMilestones(project: Project): string {
  const nodes = project.projectMilestones?.nodes ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  return nodes
    .filter((ms) => {
      if (ms.status === 'done') return false;
      if (!ms.targetDate) return false;
      const d = new Date(ms.targetDate);
      return d <= cutoff;
    })
    .sort((a, b) => new Date(a.targetDate!).getTime() - new Date(b.targetDate!).getTime())
    .map((ms) => `${ms.name} (${formatDate(ms.targetDate)})`)
    .join('; ') || '—';
}

// ── Project table row ────────────────────────────────────────────────────────

function ProjectTableRow({ project, teamColor }: { project: Project; teamColor: string }) {
  const pct = Math.round(project.progress * 100);
  const overdue = isOverdue(project);
  const atRisk  = isAtRisk(project);

  const statusStyle: React.CSSProperties = overdue
    ? { color: '#dc2626', fontWeight: 600 }
    : atRisk
    ? { color: '#d97706', fontWeight: 600 }
    : { color: '#374151' };

  return (
    <tr className="print-no-break" style={{ borderBottom: '1px solid #e5e7eb' }}>
      {/* Team color stripe */}
      <td style={{ width: 4, padding: 0, backgroundColor: teamColor }} />
      <td style={{ padding: '6px 8px', fontSize: 13, color: '#111827' }}>
        {project.name}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, ...statusStyle }}>
        {statusText(project)}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>
        {healthText(project)}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>
        {/* Progress bar + % */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 60, height: 6, borderRadius: 3,
            backgroundColor: '#e5e7eb', overflow: 'hidden', flexShrink: 0,
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${pct}%`,
              backgroundColor: pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#eab308' : '#ef4444',
            }} />
          </div>
          <span style={{ whiteSpace: 'nowrap' }}>{pct}%</span>
        </div>
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: overdue ? '#dc2626' : '#374151', whiteSpace: 'nowrap' }}>
        {formatDate(project.targetDate)}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: '#374151' }}>
        {project.lead ? formatLeadName(project.lead.name) : '—'}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 11, color: '#6b7280', maxWidth: 260 }}>
        {upcomingMilestones(project)}
      </td>
    </tr>
  );
}

// ── Team section ─────────────────────────────────────────────────────────────

function TeamSection({ team }: { team: Team }) {
  const active = team.projects.nodes.filter(
    (p) => p.state !== 'completed' && p.state !== 'cancelled'
  );
  if (active.length === 0) return null;

  return (
    <div className="print-no-break" style={{ marginBottom: 24 }}>
      {/* Team header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `2px solid ${team.color}`,
        paddingBottom: 4, marginBottom: 8,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          backgroundColor: team.color, flexShrink: 0,
          display: 'inline-block',
        }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{team.name}</span>
        <span style={{
          fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
          color: team.color, backgroundColor: `${team.color}20`,
          padding: '1px 6px', borderRadius: 3,
        }}>{team.key}</span>
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>
          {active.length} active project{active.length !== 1 ? 's' : ''}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ width: 4, padding: 0 }} />
            {['Project', 'Status', 'PM Health', 'Progress', 'Target Date', 'Lead', 'Upcoming Milestones (90d)'].map((h) => (
              <th key={h} style={{
                padding: '5px 8px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#6b7280', textAlign: 'left', whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((project) => (
            <ProjectTableRow key={project.id} project={project} teamColor={team.color} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary stats bar ─────────────────────────────────────────────────────────

function SummaryBar({ teams }: { teams: Team[] }) {
  const stats = computeStats(teams);
  const items = [
    { label: 'Active',    value: stats.active,    color: '#3b82f6' },
    { label: 'On Track',  value: stats.onTrack,   color: '#22c55e' },
    { label: 'At Risk',   value: stats.atRisk,    color: '#d97706' },
    { label: 'Overdue',   value: stats.overdue,   color: '#dc2626' },
    { label: 'Completed', value: stats.completed, color: '#6b7280' },
  ];

  return (
    <div style={{
      display: 'flex', gap: 20, padding: '8px 0', marginBottom: 20,
      borderBottom: '1px solid #e5e7eb',
    }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Standalone HTML export ────────────────────────────────────────────────────

function generateReportHTML(teams: Team[], generatedAt: string): string {
  const esc = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const stats = computeStats(teams);

  const teamSections = teams.map(team => {
    const active = team.projects.nodes.filter(p => p.state !== 'completed' && p.state !== 'cancelled');
    if (active.length === 0) return '';

    const rows = active.map(project => {
      const pct = Math.round(project.progress * 100);
      const overdue = isOverdue(project);
      const atRisk  = isAtRisk(project);
      const statusColor = overdue ? '#dc2626' : atRisk ? '#d97706' : '#374151';
      const progressColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#eab308' : '#ef4444';
      const milestones = upcomingMilestones(project);
      return `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="width:4px;padding:0;background:${team.color}"></td>
        <td style="padding:6px 8px;font-size:13px;color:#111827">${esc(project.name)}</td>
        <td style="padding:6px 8px;font-size:12px;color:${statusColor};font-weight:${overdue||atRisk?600:400}">${esc(statusText(project))}</td>
        <td style="padding:6px 8px;font-size:12px;color:#374151">${esc(healthText(project))}</td>
        <td style="padding:6px 8px;font-size:12px;color:#374151">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:60px;height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;flex-shrink:0">
              <div style="height:100%;width:${pct}%;border-radius:3px;background:${progressColor}"></div>
            </div>
            <span style="white-space:nowrap">${pct}%</span>
          </div>
        </td>
        <td style="padding:6px 8px;font-size:12px;color:${overdue?'#dc2626':'#374151'};white-space:nowrap">${esc(formatDate(project.targetDate))}</td>
        <td style="padding:6px 8px;font-size:12px;color:#374151">${esc(project.lead ? formatLeadName(project.lead.name) : '—')}</td>
        <td style="padding:6px 8px;font-size:11px;color:#6b7280;max-width:260px">${esc(milestones)}</td>
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

  const statsHtml = [
    { label: 'Active',    value: stats.active,    color: '#3b82f6' },
    { label: 'On Track',  value: stats.onTrack,   color: '#22c55e' },
    { label: 'At Risk',   value: stats.atRisk,    color: '#d97706' },
    { label: 'Overdue',   value: stats.overdue,   color: '#dc2626' },
    { label: 'Completed', value: stats.completed, color: '#6b7280' },
  ].map(({ label, value, color }) => `<div style="text-align:center">
    <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
    <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">${label}</div>
  </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SBIR Portfolio Status Report</title>
<style>
*,*::before,*::after{box-sizing:border-box;}
body{font-family:system-ui,'Segoe UI',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:32px;max-width:1200px;margin:0 auto;}
@media print{@page{margin:1.5cm;size:A4 landscape;}body{padding:0;}}
</style>
</head>
<body>
<div style="margin-bottom:20px;border-bottom:2px solid #1e40af;padding-bottom:12px;display:flex;align-items:flex-start;justify-content:space-between">
  <div>
    <div style="font-size:9px;font-weight:700;letter-spacing:.15em;color:#1e40af;text-transform:uppercase;margin-bottom:2px">COLVIN RUN NETWORKS</div>
    <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0">SBIR Portfolio Status Report</h1>
    <p style="font-size:11px;color:#6b7280;margin:4px 0 0">Generated ${esc(generatedAt)}</p>
  </div>
  <div style="font-size:9px;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:.08em;border:1px solid #e5e7eb;padding:4px 8px;border-radius:4px">CUI — SBIR Data</div>
</div>
<div style="display:flex;gap:20px;padding:8px 0;margin-bottom:20px;border-bottom:1px solid #e5e7eb">${statsHtml}</div>
${teamSections}
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
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolioWithMilestones();
      setTeams(data);
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

      {/* ── Screen-only toolbar ── */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 10,
        backgroundColor: '#1e293b', borderBottom: '1px solid #334155',
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>
          Portfolio Report Preview
        </span>
        {generatedAt && (
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Data as of {generatedAt}
          </span>
        )}
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            backgroundColor: '#334155', color: '#cbd5e1', border: '1px solid #475569',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          onClick={() => teams && triggerDownload(generateReportHTML(teams, generatedAt), 'text/html;charset=utf-8', `sbir-portfolio-report-${dateSlug}.html`)}
          disabled={loading || !!error || !teams}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            backgroundColor: '#334155', color: '#cbd5e1', border: '1px solid #475569',
            cursor: loading || error || !teams ? 'not-allowed' : 'pointer',
            opacity: loading || error || !teams ? 0.5 : 1,
          }}
        >
          <Printer size={13} />
          Download HTML
        </button>
        <button
          onClick={() => window.print()}
          disabled={loading || !!error}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            backgroundColor: '#2563eb', color: 'white', border: 'none',
            cursor: loading || error ? 'not-allowed' : 'pointer',
            opacity: loading || error ? 0.5 : 1,
          }}
        >
          <Printer size={13} />
          Print / PDF
        </button>
      </div>

      {/* ── Print content ── */}
      <div style={{ padding: '24px 32px', backgroundColor: 'white', minHeight: 'calc(100vh - 53px)' }}>

        {/* Report header */}
        <div style={{ marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#1e40af', textTransform: 'uppercase', marginBottom: 2 }}>
                COLVIN RUN NETWORKS
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>
                SBIR Portfolio Status Report
              </h1>
              {generatedAt && (
                <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>
                  Generated {generatedAt}
                </p>
              )}
            </div>
            <div style={{
              fontSize: 9, color: '#9ca3af', textAlign: 'right',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              border: '1px solid #e5e7eb', padding: '4px 8px', borderRadius: 4,
            }}>
              CUI — SBIR Data
            </div>
          </div>
        </div>

        {/* Loading / error states */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280', fontSize: 14 }}>
            Loading portfolio data…
          </div>
        )}
        {error && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#dc2626', fontSize: 14 }}>
            Error: {error}
          </div>
        )}

        {/* Report body */}
        {teams && !loading && (
          <>
            <SummaryBar teams={teams} />
            {teams.map((team) => (
              <TeamSection key={team.id} team={team} />
            ))}

            {/* Footer */}
            <div style={{
              marginTop: 32, paddingTop: 12, borderTop: '1px solid #e5e7eb',
              fontSize: 10, color: '#9ca3af', display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Colvin Run Networks — SBIR PM Dashboard</span>
              <span>Data sourced from Linear · {generatedAt}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
