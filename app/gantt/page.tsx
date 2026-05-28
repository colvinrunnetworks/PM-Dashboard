'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { GanttChart, Download, RefreshCw } from 'lucide-react';
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

// ── Bar position calculator ───────────────────────────────────────────────────

function makePositioner(minMs: number, totalMs: number) {
  return (d: Date) => ((d.getTime() - minMs) / totalMs) * 100;
}

// ── Gantt chart component ─────────────────────────────────────────────────────

const NAME_W = 260; // px

function GanttView({ teams }: { teams: GanttTeam[] }) {
  // Compute overall date range across all visible projects
  const { minDate, maxDate, months, todayPct, pct } = useMemo(() => {
    const allProjects = teams.flatMap(t => t.projects.nodes);
    const starts = allProjects.map(p => parseUTC(p.startDate)).filter(Boolean) as Date[];
    const ends   = allProjects.map(p => parseUTC(p.targetDate)).filter(Boolean) as Date[];

    if (!starts.length && !ends.length) return { minDate: null, maxDate: null, months: [], todayPct: null, pct: null };

    const rawMin = new Date(Math.min(...starts.map(d => d.getTime())));
    const rawMax = new Date(Math.max(...ends.map(d => d.getTime())));
    const minDate = startOfMonthUTC(rawMin);
    const maxDate = addMonthsUTC(rawMax, 1); // extend to end of last month

    const totalMs = maxDate.getTime() - minDate.getTime();
    const pct = makePositioner(minDate.getTime(), totalMs);

    // Month ticks
    const months: { label: string; left: number; width: number }[] = [];
    let cur = new Date(minDate);
    while (cur < maxDate) {
      const next = addMonthsUTC(cur, 1);
      months.push({
        label: fmtMonth(cur),
        left:  pct(cur),
        width: ((next.getTime() - cur.getTime()) / totalMs) * 100,
      });
      cur = next;
    }

    const now = new Date();
    const todayPct = now >= minDate && now <= maxDate ? pct(now) : null;

    return { minDate, maxDate, months, todayPct, pct };
  }, [teams]);

  if (!pct) {
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
        <div
          className="shrink-0 border-r border-slate-700/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
          style={{ width: NAME_W }}
        >
          Project
        </div>
        <div className="relative flex-1 h-8 overflow-hidden">
          {months.map(m => (
            <div
              key={m.label}
              className="absolute top-0 h-full border-l border-slate-700/40 px-1.5 flex items-center"
              style={{ left: `${m.left}%`, width: `${m.width}%` }}
            >
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap overflow-hidden">
                {m.label}
              </span>
            </div>
          ))}
          {todayPct !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10"
              style={{ left: `${todayPct}%` }}
              title="Today"
            />
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="overflow-x-auto">
        {teams.map(team => (
          <div key={team.id}>
            {/* Team header */}
            <div
              className="flex items-center border-b border-slate-700/30"
              style={{ backgroundColor: `${team.color}18` }}
            >
              <div
                className="shrink-0 flex items-center gap-2 border-r border-slate-700/40 px-3 py-2"
                style={{ width: NAME_W }}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                <span className="text-xs font-bold text-slate-200">{team.name}</span>
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-xs"
                  style={{ color: team.color, backgroundColor: `${team.color}25` }}
                >
                  {team.key}
                </span>
                <span className="ml-auto text-xs text-slate-600">{team.projects.nodes.length}</span>
              </div>
              <div className="relative flex-1 h-9">
                {todayPct !== null && (
                  <div className="absolute top-0 bottom-0 w-px bg-red-500/30" style={{ left: `${todayPct}%` }} />
                )}
              </div>
            </div>

            {/* Project rows */}
            {team.projects.nodes.length === 0 && (
              <div
                className="flex border-b border-slate-700/20"
                style={{ minHeight: 32 }}
              >
                <div
                  className="shrink-0 border-r border-slate-700/30 px-3 py-2 text-xs text-slate-600 italic"
                  style={{ width: NAME_W }}
                >
                  No projects
                </div>
                <div className="flex-1" />
              </div>
            )}

            {team.projects.nodes.map(project => {
              const s = parseUTC(project.startDate);
              const e = parseUTC(project.targetDate);
              const hasBar = s && e;
              const color = stateColor(project.state);

              const barLeft  = hasBar ? pct(s!) : 0;
              const barRight = hasBar ? pct(e!) : 0;
              const barWidth = Math.max(0.3, barRight - barLeft);

              return (
                <div
                  key={project.id}
                  className="flex border-b border-slate-700/20 group hover:bg-slate-800/40 transition-colors"
                  style={{ minHeight: 30 }}
                >
                  {/* Name cell */}
                  <div
                    className="shrink-0 flex items-center gap-2 border-r border-slate-700/30 px-3 py-1.5"
                    style={{ width: NAME_W }}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                      title={stateLabel(project.state)}
                    />
                    <span className="text-xs text-slate-300 truncate" title={project.name}>
                      {project.name}
                    </span>
                  </div>

                  {/* Bar area */}
                  <div className="relative flex-1 flex items-center">
                    {todayPct !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-500/20"
                        style={{ left: `${todayPct}%` }}
                      />
                    )}

                    {hasBar ? (
                      <div
                        className="absolute h-4 rounded"
                        style={{ left: `${barLeft}%`, width: `${barWidth}%`, backgroundColor: color, opacity: 0.85 }}
                        title={`${project.name}\n${fmtDate(project.startDate)} → ${fmtDate(project.targetDate)}\n${stateLabel(project.state)}`}
                      >
                        {/* Progress fill */}
                        <div
                          className="absolute inset-y-0 left-0 rounded opacity-40 bg-white"
                          style={{ width: `${Math.round(project.progress * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <span className="px-3 text-xs text-slate-600 italic">No dates — Backlog</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-slate-700/40 bg-slate-900/30 flex-wrap">
        {Object.entries(STATE_COLOR)
          .filter(([k]) => k !== 'cancelled')
          .map(([k, color]) => (
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
        <span className="ml-auto text-xs text-slate-700">White fill = progress</span>
      </div>
    </div>
  );
}

// ── HTML export generator (client-side) ───────────────────────────────────────

function generateExportHTML(teams: GanttTeam[], selectionLabel: string): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const allProjects = teams.flatMap(t => t.projects.nodes);
  const starts = allProjects.map(p => parseUTC(p.startDate)).filter(Boolean) as Date[];
  const ends   = allProjects.map(p => parseUTC(p.targetDate)).filter(Boolean) as Date[];

  if (!starts.length && !ends.length) return '<html><body><p>No projects with dates.</p></body></html>';

  const minDate  = startOfMonthUTC(new Date(Math.min(...starts.map(d => d.getTime()))));
  const maxDate  = addMonthsUTC(new Date(Math.max(...ends.map(d => d.getTime()))), 1);
  const totalMs  = maxDate.getTime() - minDate.getTime();
  const pct      = makePositioner(minDate.getTime(), totalMs);

  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const next = addMonthsUTC(cur, 1);
    months.push({ label: fmtMonth(cur), left: pct(cur), width: ((next.getTime() - cur.getTime()) / totalMs) * 100 });
    cur = next;
  }

  const todayPct = today >= minDate && today <= maxDate ? pct(today) : null;

  const esc = (s: string) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  let rows = '';
  for (const team of teams) {
    rows += `<tr style="background:${team.color}18">
      <td style="width:260px;padding:6px 10px;font-weight:700;font-size:11px;color:#fff;background:${team.color}cc;border-right:1px solid #555;">
        ${esc(team.name)} <span style="font-weight:400;opacity:.7">${esc(team.key)}</span>
      </td>
      <td style="background:${team.color}18;"></td>
    </tr>`;

    for (const p of team.projects.nodes) {
      const s = parseUTC(p.startDate);
      const e = parseUTC(p.targetDate);
      const color = stateColor(p.state);
      const hasBar = s && e;
      const barLeft  = hasBar ? pct(s!).toFixed(3) : '0';
      const barWidth = hasBar ? Math.max(0.3, pct(e!) - pct(s!)).toFixed(3) : '0';

      rows += `<tr>
        <td style="width:260px;min-width:260px;max-width:260px;padding:3px 10px;font-size:10px;color:#ddd;border-right:1px solid #333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #2a2a2a;" title="${esc(p.name)}">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle;"></span>${esc(p.name)}
        </td>
        <td style="position:relative;border-bottom:1px solid #2a2a2a;">
          <div style="position:relative;height:16px;width:100%;">
            ${todayPct !== null ? `<div style="position:absolute;top:0;bottom:0;width:1px;background:#e74c3c88;left:${todayPct.toFixed(3)}%;z-index:5;"></div>` : ''}
            ${hasBar ? `<div style="position:absolute;left:${barLeft}%;width:${barWidth}%;height:100%;background:${color};border-radius:2px;opacity:.85;" title="${esc(p.name)} | ${fmtDate(p.startDate)} → ${fmtDate(p.targetDate)}"></div>` : `<span style="font-size:9px;color:#555;font-style:italic;padding-left:8px;">No dates — Backlog</span>`}
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
.legend-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#999;}
.dot{width:10px;height:10px;border-radius:3px;}
table{width:100%;border-collapse:collapse;}
@media print{body{background:#fff;color:#000;padding:12px;}h1{font-size:14px;}}
</style>
</head>
<body>
<h1>Program Gantt — ${esc(selectionLabel)}</h1>
<p class="meta">Generated: ${todayStr} &nbsp;·&nbsp; Source: Linear</p>
<div class="legend">
  ${Object.entries(STATE_COLOR).filter(([k])=>k!=='cancelled').map(([k,c])=>`<div class="legend-item"><div class="dot" style="background:${c}"></div>${STATE_LABEL[k]}</div>`).join('')}
  ${todayPct !== null ? '<div class="legend-item"><div style="width:2px;height:12px;background:#e74c3c;margin-right:3px;"></div>Today</div>' : ''}
</div>

<div style="display:flex;margin-bottom:0;">
  <div style="width:260px;min-width:260px;flex-shrink:0;padding:4px 10px;font-size:9px;font-weight:700;color:#888;border-right:1px solid #333;border-bottom:2px solid #444;background:#1a1a1a;">PROJECT</div>
  <div style="flex:1;position:relative;height:22px;border-bottom:2px solid #444;background:#1a1a1a;overflow:hidden;">
    ${monthHeaders}
  </div>
</div>
<table><tbody>${rows}</tbody></table>
</body>
</html>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface TeamMeta { id: string; name: string; key: string; color: string }

export default function GanttPage() {
  const [allTeamMeta, setAllTeamMeta] = useState<TeamMeta[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null); // null = all
  const [teams, setTeams] = useState<GanttTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (teamId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const url = teamId ? `/api/gantt?teamId=${teamId}` : '/api/gantt';
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      const json = await res.json();
      const loaded: GanttTeam[] = json.teams ?? [];
      setTeams(loaded);

      // Build team metadata list from first full load (all teams)
      if (!teamId && loaded.length > 0) {
        setAllTeamMeta(loaded.map(t => ({ id: t.id, name: t.name, key: t.key, color: t.color })));
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

  const selectionLabel = useMemo(() => {
    if (!selectedTeamId) return 'All Teams';
    return allTeamMeta.find(t => t.id === selectedTeamId)?.name ?? 'Selected Team';
  }, [selectedTeamId, allTeamMeta]);

  function handleExport() {
    const html = generateExportHTML(teams, selectionLabel);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const slug = selectionLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `gantt-${slug}-${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalProjects = teams.reduce((n, t) => n + t.projects.nodes.length, 0);
  const withDates = teams
    .flatMap(t => t.projects.nodes)
    .filter(p => p.startDate && p.targetDate).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <GanttChart className="h-5 w-5 text-blue-400" />
            Gantt
          </h1>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${selectionLabel} · ${totalProjects} projects · ${withDates} with dates`}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <button
            onClick={() => load(selectedTeamId)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            disabled={loading || teams.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export HTML
          </button>
        </div>
      </div>

      {/* Team picker */}
      {allTeamMeta.length > 0 && (
        <div className="flex flex-wrap gap-2">
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
                selectedTeamId === t.id
                  ? 'border-opacity-60 text-white'
                  : 'text-slate-400 border-slate-700 hover:bg-slate-800'
              )}
              style={selectedTeamId === t.id ? {
                backgroundColor: `${t.color}25`,
                borderColor: `${t.color}80`,
                color: t.color,
              } : {}}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && teams.length === 0 && (
        <div className="flex items-center justify-center py-24 text-sm text-slate-500">
          Loading Gantt data…
        </div>
      )}

      {/* Chart */}
      {teams.length > 0 && <GanttView teams={teams} />}
    </div>
  );
}
