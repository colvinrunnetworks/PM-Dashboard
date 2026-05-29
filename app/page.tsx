'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LayoutDashboard, X } from 'lucide-react';
import { fetchPortfolio } from '@/lib/api';
import { computeStats, computeDeadlines } from '@/lib/utils';
import { StatsRow } from '@/components/StatsRow';
import { TeamCard } from '@/components/TeamCard';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import { RefreshButton } from '@/components/RefreshButton';
import { cn } from '@/lib/utils';
import type { Team } from '@/lib/types';

const STATE_META: { id: string; label: string; color: string }[] = [
  { id: 'started',   label: 'In Progress', color: '#2ecc71' },
  { id: 'planned',   label: 'Planned',     color: '#3498db' },
  { id: 'paused',    label: 'On Hold',     color: '#bdc3c7' },
  { id: 'completed', label: 'Completed',   color: '#7f8c8d' },
];

const DEFAULT_STATES = new Set(['started', 'planned', 'paused']);

export default function PortfolioPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set(DEFAULT_STATES));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolio();
      setTeams(data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleState(s: string) {
    setStateFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) { next.delete(s); } else { next.add(s); }
      return next;
    });
  }

  const filtersActive = selectedTeamId !== null || stateFilter.size !== DEFAULT_STATES.size ||
    !([...DEFAULT_STATES].every(s => stateFilter.has(s)) && stateFilter.size === DEFAULT_STATES.size);

  const viewTeams = useMemo(() => {
    let result = teams;
    if (selectedTeamId) result = result.filter(t => t.id === selectedTeamId);
    return result;
  }, [teams, selectedTeamId]);

  const stats = useMemo(() => computeStats(viewTeams), [viewTeams]);
  const deadlines = useMemo(() => computeDeadlines(viewTeams, 30), [viewTeams]);

  const totalVisible = useMemo(
    () => viewTeams.flatMap(t => t.projects.nodes).filter(p => p.state !== 'cancelled' && stateFilter.has(p.state)).length,
    [viewTeams, stateFilter]
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-blue-400" />
            Portfolio
          </h1>
          <p className="text-sm text-slate-500">
            {loading
              ? 'Loading…'
              : filtersActive
                ? `${totalVisible} projects · ${viewTeams.length} of ${teams.length} teams`
                : `${teams.length} teams · SBIR program overview`}
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

      {/* Team picker */}
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedTeamId(null)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              selectedTeamId === null
                ? 'bg-blue-600/30 text-blue-300 border-blue-600/50'
                : 'text-slate-400 border-slate-700 hover:bg-slate-800'
            )}
          >
            All Teams
          </button>
          {teams.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTeamId(prev => prev === t.id ? null : t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                selectedTeamId !== t.id && 'text-slate-400 border-slate-700 hover:bg-slate-800'
              )}
              style={selectedTeamId === t.id
                ? { backgroundColor: `${t.color}25`, borderColor: `${t.color}80`, color: t.color }
                : {}}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* State filter */}
      {teams.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 shrink-0">Status:</span>
          {STATE_META.map(({ id, label, color }) => {
            const active = stateFilter.has(id);
            return (
              <button
                key={id}
                onClick={() => toggleState(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-transparent text-white'
                    : 'border-slate-700 text-slate-500 bg-transparent hover:border-slate-600 hover:text-slate-400'
                )}
                style={active ? { backgroundColor: `${color}33`, borderColor: `${color}66`, color } : {}}
              >
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: active ? color : '#475569' }} />
                {label}
              </button>
            );
          })}
          {filtersActive && (
            <button
              onClick={() => { setSelectedTeamId(null); setStateFilter(new Set(DEFAULT_STATES)); }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <strong>Error loading data:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && teams.length === 0 && (
        <div className="flex items-center justify-center py-24 text-sm text-slate-500">
          Loading portfolio…
        </div>
      )}

      {/* Content */}
      {(!loading || teams.length > 0) && !error && (
        <>
          <StatsRow stats={stats} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* Team cards */}
            <div className="xl:col-span-2 flex flex-col gap-4">
              {viewTeams.map((team) => (
                <TeamCard key={team.id} team={team} stateFilter={stateFilter} />
              ))}
              {viewTeams.length === 0 && !loading && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-4 py-10 text-center text-sm text-slate-500">
                  No teams match the current filter.
                </div>
              )}
            </div>

            {/* Deadline panel */}
            <div>
              <DeadlinePanel deadlines={deadlines} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
