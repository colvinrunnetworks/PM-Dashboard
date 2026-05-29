import { NextResponse } from 'next/server';

const PORTFOLIO_QUERY = `{
  teams(first: 50) {
    nodes {
      id
      name
      key
      color
      projects(first: 10) {
        nodes {
          id
          name
          description
          priority
          state
          url
          health
          startDate
          targetDate
          progress
          lead { name }
          issues(first: 3) {
            nodes {
              id
              identifier
              url
              title
              priority
              state { name type }
            }
          }
        }
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
      body: JSON.stringify({ query: PORTFOLIO_QUERY }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Linear API failed: ${res.status} ${res.statusText}`, body },
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
