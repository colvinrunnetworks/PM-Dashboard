import type { Team, Milestone, WebhookResponse } from './types';

export function getConfiguredWebhookUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_N8N_BASE_URL ?? 'https://n8n.colvin.run';
  const useTest =
    process.env.NEXT_PUBLIC_USE_TEST_WEBHOOK === 'true';
  const path = useTest ? '/webhook-test/portfolio' : '/webhook/portfolio';
  return `${base}${path}`;
}

export async function fetchPortfolio(): Promise<Team[]> {
  const res = await fetch('/api/portfolio', {
    method: 'GET',
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error ?? `Request failed: ${res.status} ${res.statusText}`
    );
  }

  const raw = await res.json();
  const json: WebhookResponse = Array.isArray(raw) ? raw[0] : raw;

  if (!json?.data?.teams?.nodes) {
    throw new Error('Unexpected response shape from portfolio API');
  }

  return json.data.teams.nodes;
}

// ── Milestone types returned by /api/milestones ───────────────────────────────

interface RawMilestoneNode extends Omit<Milestone, 'url'> {
  project: {
    id: string;
    name: string;
    state: string;
    url: string;
  };
}

interface MilestonesResponse {
  data: {
    projectMilestones: {
      nodes: RawMilestoneNode[];
    };
  };
}

/**
 * Fetch all milestones from the separate /api/milestones endpoint.
 * Returns a map of projectId → Milestone[] for easy joining.
 */
export async function fetchMilestonesByProject(): Promise<Map<string, Milestone[]>> {
  const res = await fetch('/api/milestones', {
    method: 'GET',
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error ?? `Milestones request failed: ${res.status} ${res.statusText}`
    );
  }

  const raw = await res.json();
  const json = raw as MilestonesResponse;
  const nodes = json?.data?.projectMilestones?.nodes ?? [];

  // Group by project ID
  const map = new Map<string, Milestone[]>();
  for (const node of nodes) {
    const projectId = node.project.id;
    if (!map.has(projectId)) map.set(projectId, []);
    // Strip the nested `project` field; use project URL as the milestone link
    const { project, ...rest } = node;
    const milestone: Milestone = { ...rest, url: project.url };
    map.get(projectId)!.push(milestone);
  }
  return map;
}

/**
 * Fetch portfolio + milestones in parallel, then join milestones onto each project.
 */
export async function fetchPortfolioWithMilestones(): Promise<Team[]> {
  const [teams, milestoneMap] = await Promise.all([
    fetchPortfolio(),
    fetchMilestonesByProject(),
  ]);

  // Attach milestones to each project
  for (const team of teams) {
    for (const project of team.projects.nodes) {
      project.projectMilestones = {
        nodes: milestoneMap.get(project.id) ?? [],
      };
    }
  }

  return teams;
}
