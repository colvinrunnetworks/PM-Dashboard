#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load .env.local / .env ────────────────────────────────────────────────────

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const fp = path.join(process.cwd(), name);
    if (!fs.existsSync(fp)) continue;
    for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    console.log(`  env loaded from ${name}`);
    return;
  }
}

loadEnv();

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('\nERROR: LINEAR_API_KEY not found.');
  console.error('Add it to .env.local in this directory:');
  console.error('  LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxx\n');
  process.exit(1);
}

// ── Linear GraphQL helper ─────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linear API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json.data;
}

// ── Fetch all SDEAT projects (paginated) ──────────────────────────────────────

const PROJECTS_QUERY = `
  query SDEATProjects($after: String) {
    teams(filter: { key: { eq: "SDE" } }) {
      nodes {
        id
        name
        projects(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            name
            state
            startDate
            targetDate
            description
          }
        }
      }
    }
  }
`;

async function fetchAllProjects() {
  const projects = [];
  let after = null;

  while (true) {
    const data = await gql(PROJECTS_QUERY, after ? { after } : {});
    const team = data.teams?.nodes?.[0];
    if (!team) throw new Error('SDEAT team not found (key "SDE"). Check the team key in Linear.');

    const page = team.projects;
    projects.push(...page.nodes);
    console.log(`  fetched ${page.nodes.length} projects (total so far: ${projects.length})`);

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return projects;
}

// ── Use-case grouping ─────────────────────────────────────────────────────────

const USE_CASES = [
  {
    id: 'uc1',
    name: 'UC1 — TIPC: Task Financial Planning & Management',
    terms: ['use case #1', 'tipc', '1c)', '1d)', '1e)', '1f)'],
    headerColor: '#1a237e',
  },
  {
    id: 'uc2',
    name: 'UC2 — WLP: Workload Planning',
    terms: ['use case #2', 'wlp'],
    headerColor: '#1565c0',
  },
  {
    id: 'uc3',
    name: 'UC3 — ILS: Integrated Logistics Support',
    terms: ['use case #3', 'ils'],
    headerColor: '#4a148c',
  },
  {
    id: 'uc4',
    name: 'UC4 — OOQ: Quality Assurance',
    terms: ['use case #4', 'ooq'],
    headerColor: '#880e4f',
  },
  {
    id: 'uc5',
    name: 'UC5 — Fleet Tasking Management',
    terms: ['1g)', '1h)'],
    headerColor: '#e65100',
  },
  {
    id: 'uc6',
    name: 'UC6 — Funding Document Acceptance',
    terms: ['1b)'],
    headerColor: '#1b5e20',
  },
  {
    id: 'pm',
    name: 'Program Management',
    terms: [],           // catch-all
    headerColor: '#37474f',
  },
];

function groupProjects(projects) {
  const groups = USE_CASES.map(uc => ({ ...uc, projects: [] }));
  const catchAll = groups[groups.length - 1];

  for (const p of projects) {
    const lower = p.name.toLowerCase();
    let matched = false;
    for (const g of groups.slice(0, -1)) {
      if (g.terms.some(t => lower.includes(t.toLowerCase()))) {
        g.projects.push(p);
        matched = true;
        break;
      }
    }
    if (!matched) catchAll.projects.push(p);
  }

  // Sort each group by startDate asc (nulls last)
  for (const g of groups) {
    g.projects.sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate) - new Date(b.startDate);
    });
  }

  return groups.filter(g => g.projects.length > 0);
}

// ── Status color mapping ──────────────────────────────────────────────────────

const STATUS_COLORS = {
  started:   { color: '#2ecc71', label: 'In Progress' },
  planned:   { color: '#3498db', label: 'Planned'     },
  paused:    { color: '#bdc3c7', label: 'On Hold'     },
  cancelled: { color: '#bdc3c7', label: 'Cancelled'   },
  completed: { color: '#7f8c8d', label: 'Completed'   },
};

function statusInfo(state) {
  return STATUS_COLORS[state] ?? { color: '#bdc3c7', label: state ?? 'Backlog' };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseDate(iso) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00Z');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtMonth(date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(1);
  return d;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ── HTML generator ────────────────────────────────────────────────────────────

function buildHTML(groups) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Compute overall date range
  const allProjects = groups.flatMap(g => g.projects);
  const starts = allProjects.map(p => parseDate(p.startDate)).filter(Boolean);
  const ends   = allProjects.map(p => parseDate(p.targetDate)).filter(Boolean);

  if (!starts.length && !ends.length) {
    return '<html><body><p>No projects with dates found.</p></body></html>';
  }

  const minDate = startOfMonth(new Date(Math.min(...starts.map(d => d.getTime()))));
  const maxDateRaw = new Date(Math.max(...ends.map(d => d.getTime())));
  // Extend to end of that month
  const maxDate = new Date(Date.UTC(maxDateRaw.getUTCFullYear(), maxDateRaw.getUTCMonth() + 1, 1));

  const totalMs = maxDate - minDate;

  function pct(date) {
    if (!date) return null;
    const clamped = Math.min(Math.max(date.getTime(), minDate.getTime()), maxDate.getTime());
    return ((clamped - minDate) / totalMs * 100).toFixed(3);
  }

  // Month columns
  const months = [];
  let cur = new Date(minDate);
  while (cur < maxDate) {
    const next = addMonths(cur, 1);
    months.push({
      label: fmtMonth(cur),
      left:  pct(cur),
      width: ((next - cur) / totalMs * 100).toFixed(3),
    });
    cur = next;
  }

  // Today marker position
  const todayPct = today >= minDate && today <= maxDate ? pct(today) : null;

  // Build rows HTML
  let rowsHTML = '';
  for (const g of groups) {
    // Group header
    rowsHTML += `
      <tr class="group-header">
        <td class="name-cell" style="background:${g.headerColor};color:#fff;font-weight:700;font-size:12px;padding:6px 10px;">
          ${escHtml(g.name)}
        </td>
        <td class="bar-cell" style="background:${g.headerColor}22;"></td>
      </tr>`;

    for (const p of g.projects) {
      const s   = parseDate(p.startDate);
      const e   = parseDate(p.targetDate);
      const si  = statusInfo(p.state);
      const hasBar = s && e;

      let barHTML = '';
      if (hasBar) {
        const left  = pct(s);
        const right = pct(e);
        const width = (right - left).toFixed(3);
        barHTML = `
          <div class="bar" style="left:${left}%;width:${Math.max(0.3, width)}%;background:${si.color};" title="${escHtml(p.name)} | ${fmtDate(p.startDate)} → ${fmtDate(p.targetDate)}">
            <span class="bar-label">${fmtDate(p.startDate)} → ${fmtDate(p.targetDate)}</span>
          </div>`;
      } else {
        barHTML = `<span class="no-date">[No dates — Backlog]</span>`;
      }

      rowsHTML += `
        <tr class="project-row">
          <td class="name-cell">
            <span class="status-dot" style="background:${si.color};" title="${si.label}"></span>
            ${escHtml(p.name)}
          </td>
          <td class="bar-cell">
            <div class="bar-track">${barHTML}</div>
          </td>
        </tr>`;
    }
  }

  // Month header HTML
  let monthsHTML = '';
  for (const m of months) {
    monthsHTML += `<div class="month-label" style="left:${m.left}%;width:${m.width}%;">${escHtml(m.label)}</div>`;
  }

  // Today line HTML
  const todayHTML = todayPct !== null
    ? `<div class="today-line" style="left:${todayPct}%;" title="Today: ${todayStr}"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SDEAT Program Schedule</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
    font-size: 12px;
    color: #1a1a1a;
    background: #fff;
    padding: 24px;
  }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
  .meta { font-size: 11px; color: #666; margin-bottom: 16px; }

  /* Legend */
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; align-items: center; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .legend-today { display: flex; align-items: center; gap: 5px; font-size: 11px; }
  .legend-today-line { width: 2px; height: 14px; background: #e74c3c; }

  /* Table layout */
  .gantt-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .name-cell {
    width: 280px;
    min-width: 280px;
    max-width: 280px;
    padding: 4px 10px;
    border-right: 1px solid #ddd;
    border-bottom: 1px solid #eee;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
  }
  .bar-cell {
    padding: 4px 0;
    border-bottom: 1px solid #eee;
    position: relative;
    vertical-align: middle;
  }

  /* Month header row */
  .months-row { position: relative; height: 24px; margin-left: 280px; border-bottom: 2px solid #ccc; }
  .month-label {
    position: absolute;
    top: 0;
    height: 100%;
    font-size: 10px;
    font-weight: 600;
    color: #555;
    border-left: 1px solid #e0e0e0;
    padding: 4px 3px;
    overflow: hidden;
    white-space: nowrap;
  }

  /* Group header */
  tr.group-header .name-cell { font-size: 11px; }
  tr.group-header .bar-cell  { height: 28px; }

  /* Project row */
  tr.project-row { height: 26px; }
  tr.project-row:hover { background: #f5f5f5; }

  .status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 5px;
    flex-shrink: 0;
    vertical-align: middle;
  }

  /* Bar track */
  .bar-track {
    position: relative;
    height: 18px;
    width: 100%;
  }
  .bar {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 3px;
    min-width: 4px;
    overflow: hidden;
  }
  .bar-label {
    display: none;
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 9px;
    color: rgba(255,255,255,0.9);
    white-space: nowrap;
    overflow: hidden;
  }
  .bar:hover .bar-label { display: block; }

  .no-date {
    font-size: 10px;
    color: #aaa;
    padding-left: 8px;
    font-style: italic;
  }

  /* Today line (rendered inside each .bar-track via JS) */
  .today-line {
    position: absolute;
    top: -2px;
    width: 2px;
    height: calc(100% + 4px);
    background: #e74c3c;
    z-index: 10;
    pointer-events: none;
  }

  @media print {
    body { padding: 12px; font-size: 10px; }
    h1   { font-size: 14px; }
    .name-cell { width: 220px; min-width: 220px; max-width: 220px; font-size: 9px; }
    .months-row { margin-left: 220px; }
    tr.project-row { height: 20px; }
    .bar-track { height: 14px; }
    .gantt-wrap { overflow: visible; }
  }
</style>
</head>
<body>

<h1>SDEAT Program Schedule</h1>
<p class="meta">Generated: ${todayStr} &nbsp;·&nbsp; Source: Linear (SDE team) &nbsp;·&nbsp; Timeline: ${fmtMonth(minDate)} – ${fmtMonth(addMonths(maxDate, -1))}</p>

<div class="legend">
  <strong style="font-size:11px;">Legend:</strong>
  ${Object.entries(STATUS_COLORS).filter(([k]) => ['started','planned','paused','completed'].includes(k)).map(([, v]) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${v.color};"></div>${v.label}</div>`
  ).join('')}
  ${todayPct !== null ? `<div class="legend-today"><div class="legend-today-line"></div> Today</div>` : ''}
</div>

<div class="gantt-wrap">
  <!-- Month header (positioned outside table for layout reasons) -->
  <div style="display:flex;">
    <div style="width:280px;min-width:280px;flex-shrink:0;border-right:1px solid #ddd;padding:4px 10px;font-size:10px;font-weight:700;color:#555;border-bottom:2px solid #ccc;background:#f9f9f9;">
      Project
    </div>
    <div style="flex:1;position:relative;border-bottom:2px solid #ccc;height:24px;background:#f9f9f9;overflow:hidden;">
      ${monthsHTML}
    </div>
  </div>

  <table>
    <tbody>${rowsHTML}</tbody>
  </table>
</div>

<script>
  // Inject today-line into every bar-track
  const todayPct = ${todayPct !== null ? todayPct : 'null'};
  if (todayPct !== null) {
    document.querySelectorAll('.bar-track').forEach(function(track) {
      const line = document.createElement('div');
      line.className = 'today-line';
      line.style.left = todayPct + '%';
      line.title = 'Today: ${todayStr}';
      track.appendChild(line);
    });
  }
</script>

</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Text summary generator ────────────────────────────────────────────────────

function buildTextSummary(groups) {
  const lines = [
    'SDEAT Program Schedule — Summary',
    `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    ['Use Case', 'Project', 'Start', 'End', 'Status'].join('\t'),
    ['--------', '-------', '-----', '---', '------'].join('\t'),
  ];

  for (const g of groups) {
    for (const p of g.projects) {
      lines.push([
        g.name,
        p.name,
        p.startDate  ?? '—',
        p.targetDate ?? '—',
        statusInfo(p.state).label,
      ].join('\t'));
    }
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── SDEAT Gantt Export ──────────────────────────────\n');

  console.log('Fetching projects from Linear...');
  const projects = await fetchAllProjects();
  console.log(`\nTotal projects retrieved: ${projects.length}`);

  console.log('\nGrouping into use cases...');
  const groups = groupProjects(projects);
  for (const g of groups) {
    console.log(`  ${g.name}: ${g.projects.length} projects`);
  }

  const exportsDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
    console.log('\nCreated exports/ directory');
  }

  const htmlPath = path.join(exportsDir, 'sdeat-gantt.html');
  const txtPath  = path.join(exportsDir, 'sdeat-gantt-summary.txt');

  console.log('\nGenerating HTML Gantt chart...');
  fs.writeFileSync(htmlPath, buildHTML(groups), 'utf8');
  console.log(`  ✓  ${htmlPath}`);

  console.log('Generating text summary...');
  fs.writeFileSync(txtPath, buildTextSummary(groups), 'utf8');
  console.log(`  ✓  ${txtPath}`);

  const total = groups.reduce((n, g) => n + g.projects.length, 0);
  const withDates = groups.flatMap(g => g.projects).filter(p => p.startDate && p.targetDate).length;

  console.log(`\n── Done ────────────────────────────────────────────`);
  console.log(`  Projects exported : ${total}`);
  console.log(`  With date bars    : ${withDates}`);
  console.log(`  Backlog (no dates): ${total - withDates}`);
  console.log(`\n  Open in browser   : exports/sdeat-gantt.html`);
  console.log(`  Text summary      : exports/sdeat-gantt-summary.txt\n`);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  if (err.message.includes('401') || err.message.includes('403') || err.message.includes('Unauthorized')) {
    console.error('\nYour API key is invalid or expired.');
    console.error('Get a new one: Linear → Settings → API → Personal API keys');
    console.error('Then update LINEAR_API_KEY in .env.local\n');
  }
  process.exit(1);
});
