'use client';

import { useState, useMemo, useRef } from 'react';
import { Upload, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimesheetRow {
  email: string;
  fname: string;
  lname: string;
  group: string;
  date: string;
  hours: number;
  jobcode: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseTimesheetCSV(text: string): TimesheetRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);
  const iUsername = idx('username');
  const iFname = idx('fname');
  const iLname = idx('lname');
  const iGroup = idx('group');
  const iDate = idx('local_date');
  const iHours = idx('hours');
  const iJobcode = idx('jobcode_1');

  if ([iUsername, iFname, iLname, iGroup, iDate, iHours, iJobcode].some((i) => i < 0)) {
    throw new Error(
      'CSV missing required columns. Expected: username, fname, lname, group, local_date, hours, jobcode_1'
    );
  }

  const rows: TimesheetRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const hours = parseFloat(cols[iHours] ?? '0');
    if (!hours || isNaN(hours)) continue;
    const jobcode = cols[iJobcode]?.trim();
    if (!jobcode) continue;
    rows.push({
      email: cols[iUsername]?.trim() ?? '',
      fname: cols[iFname]?.trim() ?? '',
      lname: cols[iLname]?.trim() ?? '',
      group: cols[iGroup]?.trim() ?? '',
      date: cols[iDate]?.trim() ?? '',
      hours,
      jobcode,
    });
  }
  return rows;
}

type Category = 'direct' | 'overhead' | 'bd' | 'fa' | 'ird' | 'bp' | 'pto' | 'sick';

const CAT_LABEL: Record<Category, string> = {
  direct: 'Direct',
  overhead: 'Overhead',
  bd: 'Biz Dev',
  fa: 'F&A',
  ird: 'IR&D',
  bp: 'B&P',
  pto: 'PTO',
  sick: 'Sick',
};

const CAT_COLOR: Record<Category, string> = {
  direct: '#3b82f6',
  overhead: '#64748b',
  bd: '#8b5cf6',
  fa: '#6366f1',
  ird: '#14b8a6',
  bp: '#f59e0b',
  pto: '#eab308',
  sick: '#ef4444',
};

const CAT_ORDER: Category[] = ['direct', 'bd', 'ird', 'bp', 'fa', 'overhead', 'pto', 'sick'];

function classifyJobcode(jobcode: string): Category {
  if (/^\d/.test(jobcode)) return 'direct';
  const lower = jobcode.toLowerCase();
  if (lower.includes('overhead')) return 'overhead';
  if (lower.includes('business development')) return 'bd';
  if (lower.includes('finance') || lower.includes('admin')) return 'fa';
  if (lower.includes('ir & d') || lower.includes('ir&d') || lower.includes('irad')) return 'ird';
  if (lower.includes('bid') || lower.includes('proposal')) return 'bp';
  if (lower.includes('pto')) return 'pto';
  if (lower.includes('sick')) return 'sick';
  return 'overhead';
}

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function weekLabel(monday: string): string {
  const d = new Date(monday + 'T00:00:00');
  return `Wk of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function periodLabel(rows: TimesheetRow[]): string {
  const dates = rows.map((r) => r.date).sort();
  const start = new Date(dates[0] + 'T00:00:00');
  const end = new Date(dates[dates.length - 1] + 'T00:00:00');
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function emptyByCategory(): Record<Category, number> {
  return { direct: 0, overhead: 0, bd: 0, fa: 0, ird: 0, bp: 0, pto: 0, sick: 0 };
}

interface PersonStats {
  email: string;
  name: string;
  group: string;
  byCategory: Record<Category, number>;
  byProject: { jobcode: string; hours: number }[];
  byWeek: { monday: string; label: string; direct: number; total: number }[];
  totalHours: number;
  directHours: number;
  leaveHours: number;
  utilization: number;
}

function buildStats(
  rows: TimesheetRow[],
  weekFilter: string
): {
  people: PersonStats[];
  weeks: { monday: string; label: string }[];
  totalHours: number;
  totalDirect: number;
  avgUtil: number;
} {
  const filtered = weekFilter === 'all' ? rows : rows.filter((r) => getMondayOf(r.date) === weekFilter);

  const weekSet = new Set<string>();
  for (const r of rows) weekSet.add(getMondayOf(r.date));
  const weeks = [...weekSet].sort().map((monday) => ({ monday, label: weekLabel(monday) }));

  const peopleMap = new Map<
    string,
    { info: Pick<PersonStats, 'email' | 'name' | 'group'>; rows: TimesheetRow[] }
  >();
  for (const row of filtered) {
    if (!peopleMap.has(row.email)) {
      peopleMap.set(row.email, {
        info: { email: row.email, name: `${row.fname} ${row.lname}`, group: row.group },
        rows: [],
      });
    }
    peopleMap.get(row.email)!.rows.push(row);
  }

  const people: PersonStats[] = [];
  let totalHours = 0;
  let totalDirect = 0;
  let utilSum = 0;
  let utilCount = 0;

  for (const { info, rows: pRows } of peopleMap.values()) {
    const byCategory = emptyByCategory();
    const projectMap = new Map<string, number>();
    const weekMap = new Map<string, { direct: number; total: number }>();

    for (const row of pRows) {
      const cat = classifyJobcode(row.jobcode);
      byCategory[cat] += row.hours;
      if (cat === 'direct') {
        projectMap.set(row.jobcode, (projectMap.get(row.jobcode) ?? 0) + row.hours);
      }
      const monday = getMondayOf(row.date);
      if (!weekMap.has(monday)) weekMap.set(monday, { direct: 0, total: 0 });
      weekMap.get(monday)!.total += row.hours;
      if (cat === 'direct') weekMap.get(monday)!.direct += row.hours;
    }

    const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
    const direct = byCategory.direct;
    const leave = byCategory.pto + byCategory.sick;
    const workable = total - leave;
    const util = workable > 0 ? (direct / workable) * 100 : 0;

    totalHours += total;
    totalDirect += direct;
    if (workable > 0) {
      utilSum += util;
      utilCount++;
    }

    people.push({
      ...info,
      byCategory,
      byProject: [...projectMap.entries()]
        .map(([jobcode, hours]) => ({ jobcode, hours }))
        .sort((a, b) => b.hours - a.hours),
      byWeek: weeks.map(({ monday, label }) => {
        const w = weekMap.get(monday) ?? { direct: 0, total: 0 };
        return { monday, label, ...w };
      }),
      totalHours: total,
      directHours: direct,
      leaveHours: leave,
      utilization: util,
    });
  }

  people.sort((a, b) => b.totalHours - a.totalHours);

  return {
    people,
    weeks,
    totalHours,
    totalDirect,
    avgUtil: utilCount > 0 ? utilSum / utilCount : 0,
  };
}

function utilColor(util: number): string {
  if (util >= 70) return '#22c55e';
  if (util >= 50) return '#eab308';
  if (util >= 30) return '#f97316';
  return '#ef4444';
}

function PersonCard({
  person,
  weeks,
}: {
  person: PersonStats;
  weeks: { monday: string; label: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const total = person.totalHours;
  const onLeaveOnly = total > 0 && total === person.leaveHours;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-slate-700/30">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-slate-200 text-sm">{person.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{person.email.split('@')[0]}</div>
          </div>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
              person.group === 'Executives'
                ? 'bg-purple-900/50 text-purple-300'
                : 'bg-blue-900/40 text-blue-300'
            )}
          >
            {person.group === 'Executives' ? 'Leadership' : person.group}
          </span>
        </div>

        <div className="flex items-end gap-4 mt-3">
          <div>
            <div
              className="text-2xl font-bold tabular-nums"
              style={{ color: onLeaveOnly ? '#64748b' : utilColor(person.utilization) }}
            >
              {onLeaveOnly ? '—' : `${Math.round(person.utilization)}%`}
            </div>
            <div className="text-xs text-slate-500">utilization</div>
          </div>
          <div className="w-px h-8 bg-slate-700/60" />
          <div>
            <div className="text-lg font-bold tabular-nums text-slate-200">
              {person.directHours.toFixed(1)}h
            </div>
            <div className="text-xs text-slate-500">direct</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-slate-400">
              {person.totalHours.toFixed(1)}h
            </div>
            <div className="text-xs text-slate-500">total</div>
          </div>
          {person.leaveHours > 0 && (
            <div>
              <div className="text-lg font-bold tabular-nums text-yellow-500">
                {person.leaveHours.toFixed(1)}h
              </div>
              <div className="text-xs text-slate-500">leave</div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-700/30">
        <div className="flex h-3 rounded overflow-hidden gap-px">
          {CAT_ORDER.map((cat) => {
            const hours = person.byCategory[cat];
            if (!hours || !total) return null;
            const pct = (hours / total) * 100;
            return (
              <div
                key={cat}
                style={{ width: `${pct}%`, backgroundColor: CAT_COLOR[cat] }}
                title={`${CAT_LABEL[cat]}: ${hours.toFixed(1)}h`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {CAT_ORDER.map((cat) => {
            const hours = person.byCategory[cat];
            if (!hours) return null;
            return (
              <div key={cat} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: CAT_COLOR[cat] }}
                />
                <span className="text-xs text-slate-400">
                  {CAT_LABEL[cat]} {hours.toFixed(1)}h
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {weeks.length > 1 && (
        <div className="px-4 py-2.5 border-b border-slate-700/30 flex gap-3">
          {person.byWeek.map((w) => (
            <div key={w.monday} className="flex-1 text-center">
              <div className="text-xs text-slate-500 mb-1 truncate">{w.label}</div>
              <div className="text-sm font-semibold tabular-nums text-slate-300">
                {w.total.toFixed(0)}h
              </div>
              <div className="text-xs text-slate-600">{w.direct.toFixed(0)}h direct</div>
            </div>
          ))}
        </div>
      )}

      {person.byProject.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-800/40 transition-colors"
          >
            <span className="text-xs font-medium text-slate-400">
              {person.byProject.length} project{person.byProject.length !== 1 ? 's' : ''} ·{' '}
              {person.directHours.toFixed(1)}h direct
            </span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
            )}
          </button>
          {expanded && (
            <div className="px-4 pb-3 flex flex-col gap-2">
              {person.byProject.map((p) => {
                const pct =
                  person.directHours > 0 ? (p.hours / person.directHours) * 100 : 0;
                return (
                  <div key={p.jobcode}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-slate-300 truncate max-w-[200px]">
                        {p.jobcode}
                      </span>
                      <span className="text-xs tabular-nums text-slate-400 shrink-0 ml-2">
                        {p.hours.toFixed(1)}h ({Math.round(pct)}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-700/50 rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${pct}%`, backgroundColor: CAT_COLOR.direct }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UploadZone({ onData }: { onData: (rows: TimesheetRow[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function processFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseTimesheetCSV(text);
        if (rows.length === 0) throw new Error('No valid rows found in file');
        onData(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse file');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) processFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'w-full max-w-md rounded-xl border-2 border-dashed px-8 py-12 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-blue-500 bg-blue-950/20'
            : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/30'
        )}
      >
        <Upload className="h-10 w-10 text-slate-600 mx-auto mb-4" />
        <div className="text-sm font-medium text-slate-300 mb-1">
          Drop your QuickBooks Time CSV here
        </div>
        <div className="text-xs text-slate-500">or click to browse</div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />
      </div>
      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-4 py-2 max-w-md text-center">
          {error}
        </div>
      )}
      <div className="text-xs text-slate-600 text-center max-w-sm">
        Export from QuickBooks Time → Reports → Time Activities. Supports the standard CSV
        format with columns: username, fname, lname, group, local_date, hours, jobcode_1.
      </div>
    </div>
  );
}

export default function BillableHoursPage() {
  const [rows, setRows] = useState<TimesheetRow[] | null>(null);
  const [weekFilter, setWeekFilter] = useState('all');

  const { people, weeks, totalHours, totalDirect, avgUtil } = useMemo(
    () =>
      rows
        ? buildStats(rows, weekFilter)
        : { people: [], weeks: [], totalHours: 0, totalDirect: 0, avgUtil: 0 },
    [rows, weekFilter]
  );

  const period = useMemo(() => (rows ? periodLabel(rows) : ''), [rows]);

  if (!rows) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-white">Billable Hours</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Upload a QuickBooks Time CSV to view team utilization
          </p>
        </div>
        <UploadZone onData={setRows} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-white">Billable Hours</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {period} · {people.length} people
          </p>
        </div>
        <button
          onClick={() => { setRows(null); setWeekFilter('all'); }}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors border border-slate-700 rounded px-2.5 py-1.5"
        >
          <X className="h-3.5 w-3.5" />
          Load new file
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
          <div className="text-xl font-bold tabular-nums text-slate-200">{totalHours.toFixed(0)}h</div>
          <div className="text-xs text-slate-600">Total hours</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
          <div className="text-xl font-bold tabular-nums text-blue-400">{totalDirect.toFixed(0)}h</div>
          <div className="text-xs text-slate-600">Direct billable</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
          <div className="text-xl font-bold tabular-nums" style={{ color: utilColor(avgUtil) }}>
            {Math.round(avgUtil)}%
          </div>
          <div className="text-xs text-slate-600">Avg utilization</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-center">
          <div className="text-xl font-bold tabular-nums text-slate-200">{people.length}</div>
          <div className="text-xs text-slate-600">People</div>
        </div>
      </div>

      {weeks.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 shrink-0">Filter:</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setWeekFilter('all')}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium border transition-colors',
                weekFilter === 'all'
                  ? 'bg-blue-600/30 text-blue-300 border-blue-600/50'
                  : 'text-slate-400 border-slate-700 hover:bg-slate-800'
              )}
            >
              All weeks
            </button>
            {weeks.map((w) => (
              <button
                key={w.monday}
                onClick={() => setWeekFilter(w.monday)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium border transition-colors',
                  weekFilter === w.monday
                    ? 'bg-blue-600/30 text-blue-300 border-blue-600/50'
                    : 'text-slate-400 border-slate-700 hover:bg-slate-800'
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {people.map((p) => (
          <PersonCard key={p.email} person={p} weeks={weeks} />
        ))}
      </div>
    </div>
  );
}
