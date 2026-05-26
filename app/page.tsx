'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { fetchPortfolio } from '@/lib/api';
import { computeStats, computeDeadlines } from '@/lib/utils';
import { StatsRow } from '@/components/StatsRow';
import { TeamCard } from '@/components/TeamCard';
import { DeadlinePanel } from '@/components/DeadlinePanel';
import { RefreshButton } from '@/components/RefreshButton';
import type { Team } from '@/lib/types';

export default function PortfolioPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

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

  const stats = useMemo(() => computeStats(teams), [teams]);
  const deadlines = useMemo(() => computeDeadlines(teams, 30), [teams]);

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
            {teams.length} teams · SBIR program overview
          </p>
        </div>
        <RefreshButton onRefresh={load} loading={loading} lastRefreshed={lastRefreshed} />
      </div>

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
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))}
              {teams.length === 0 && !loading && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-4 py-10 text-center text-sm text-slate-500">
                  No teams found. Check your Linear API key in Settings.
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
