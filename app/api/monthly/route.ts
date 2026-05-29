import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('teamId') ?? '';
  const year   = parseInt(searchParams.get('year')  ?? '0', 10);
  const month  = parseInt(searchParams.get('month') ?? '0', 10); // 1–12

  if (!teamId || !year || month < 1 || month > 12) {
    return NextResponse.json({ error: 'teamId, year, month (1-12) required' }, { status: 400 });
  }

  const startISO = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endISO   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

  const key = process.env.LINEAR_API_KEY ?? '';
  if (!key) return NextResponse.json({ error: 'LINEAR_API_KEY not configured' }, { status: 500 });

  const query = `{
    completedIssues: issues(
      filter: {
        team: { id: { eq: "${teamId}" } }
        completedAt: { gte: "${startISO}", lte: "${endISO}" }
      }
      first: 250
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        priority
        state { name type }
        project { id name }
        completedAt
      }
    }
    createdIssues: issues(
      filter: {
        team: { id: { eq: "${teamId}" } }
        createdAt: { gte: "${startISO}", lte: "${endISO}" }
      }
      first: 250
      orderBy: createdAt
    ) {
      nodes {
        id
        identifier
        title
        priority
        state { name type }
        project { id name }
        createdAt
      }
    }
  }`;

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': key },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Linear API failed: ${res.status}`, body }, { status: res.status });
    }
    const json = await res.json();
    return NextResponse.json(json?.data ?? {});
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
