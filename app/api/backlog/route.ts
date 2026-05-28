import { NextResponse } from 'next/server';

// Fetch issues that are unprioritized (priority=0) or stuck in triage/backlog state.
// Queried directly (not nested through teams→projects) to stay well under Linear's
// 10k complexity limit. Returns issues grouped by project ID.
const BACKLOG_QUERY = `{
  issues(
    first: 250
    filter: {
      or: [
        { priority: { eq: 0 } }
        { state: { type: { in: ["triage", "backlog"] } } }
      ]
    }
  ) {
    nodes {
      id
      identifier
      title
      priority
      state { name type }
      project { id }
      assignee { name }
    }
    pageInfo { hasNextPage }
  }
}`;

export async function GET() {
  const linearApiKey = process.env.LINEAR_API_KEY ?? '';

  if (!linearApiKey) {
    return NextResponse.json(
      { error: 'LINEAR_API_KEY not configured in .env.local' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': linearApiKey,
      },
      body: JSON.stringify({ query: BACKLOG_QUERY }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try { detail = JSON.stringify(JSON.parse(body), null, 2); } catch { /* leave as text */ }
      return NextResponse.json(
        { error: `Linear API ${res.status}: ${res.statusText}`, detail },
        { status: res.status }
      );
    }

    const data = await res.json();

    if (data.errors) {
      return NextResponse.json(
        { error: 'Linear GraphQL error', errors: data.errors },
        { status: 400 }
      );
    }

    // Group issues by project ID
    const nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      priority: number;
      state: { name: string; type: string };
      project: { id: string } | null;
      assignee: { name: string } | null;
    }> = data?.data?.issues?.nodes ?? [];

    const issuesByProject: Record<string, typeof nodes> = {};
    for (const issue of nodes) {
      if (!issue.project) continue; // skip orphan issues
      const pid = issue.project.id;
      if (!issuesByProject[pid]) issuesByProject[pid] = [];
      issuesByProject[pid].push(issue);
    }

    return NextResponse.json({
      issuesByProject,
      hasNextPage: data?.data?.issues?.pageInfo?.hasNextPage ?? false,
      totalFetched: nodes.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
