import { NextResponse } from 'next/server';

// Fetch all project milestones via the top-level query.
// Nesting projectMilestones inside projects blows the 10k complexity limit,
// so we query them at the top level and join to team data client-side.
const MILESTONES_QUERY = `{
  projectMilestones(first: 250) {
    nodes {
      id
      name
      description
      targetDate
      progress
      status
      sortOrder
      project {
        id
        name
        state
      }
    }
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
      body: JSON.stringify({ query: MILESTONES_QUERY }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Linear API failed: ${res.status} ${res.statusText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
