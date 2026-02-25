'use client';

import { useState, useEffect } from 'react';
import { fetchPortfolio } from './api';
import { isOverdue, isAtRisk, daysUntil } from './utils';

// ── Shared fetch cache ────────────────────────────────────────────────────────

interface CachedCounts {
  attention: number; // overdue + at-risk projects
  timeline:  number; // projects/milestones with deadlines beyond 30 days
}

let cached: CachedCounts | null = null;
let fetchPromise: Promise<CachedCounts> | null = null;

async function loadCounts(): Promise<CachedCounts> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetchPortfolio().then((teams) => {
    const projects = teams.flatMap((t) => t.projects.nodes);

    const attention = projects.filter((p) => isOverdue(p) || isAtRisk(p)).length;

    // Beyond-30d: active projects with a targetDate > 30 days away
    const timeline = projects.filter((p) => {
      if (p.state === 'completed' || p.state === 'cancelled') return false;
      if (!p.targetDate) return false;
      return daysUntil(p.targetDate) > 30;
    }).length;

    cached = { attention, timeline };
    return cached;
  });
  return fetchPromise;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Returns the number of projects that are overdue or at-risk.
 */
export function useAttentionCount(): number | null {
  const [count, setCount] = useState<number | null>(cached?.attention ?? null);

  useEffect(() => {
    if (cached !== null) { setCount(cached.attention); return; }
    loadCounts().then((c) => setCount(c.attention)).catch(() => setCount(null));
  }, []);

  return count;
}

/**
 * Returns the number of active projects with deadlines beyond 30 days.
 * Used to badge the Timeline nav link.
 */
export function useTimelineBeyondCount(): number | null {
  const [count, setCount] = useState<number | null>(cached?.timeline ?? null);

  useEffect(() => {
    if (cached !== null) { setCount(cached.timeline); return; }
    loadCounts().then((c) => setCount(c.timeline)).catch(() => setCount(null));
  }, []);

  return count;
}

/** Call this to bust the cache after a manual data refresh. */
export function invalidateAttentionCache(): void {
  cached = null;
  fetchPromise = null;
}
