import { NextResponse } from 'next/server';

// Query issues at the top level to avoid nested complexity limits.
// We fetch up to 250 active issues with assignee + creator + project + team context.
// Filters: exclude cancelled/completed states, exclude issues with no project.
const WORKLOAD_QUERY = `{
  issues(
    first: 250
    filter: {
      state: { type: { nin: ["completed", "cancelled"] } }
      project: { null: false }
    }
  ) {
    nodes {
      id
      identifier
      url
      title
      priority
      createdAt
      state { name type }
      assignee {
        id
        name
        email
        avatarUrl
      }
      creator {
        id
        name
        email
      }
      project {
        id
        name
      }
      team {
        id
        name
        key
        color
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
      body: JSON.stringify({ query: WORKLOAD_QUERY }),
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
