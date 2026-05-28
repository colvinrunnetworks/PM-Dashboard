import { NextResponse } from 'next/server';

// All teams — no issues field keeps complexity well under 10k limit
const ALL_TEAMS_QUERY = `{
  teams(first: 50) {
    nodes {
      id name key color
      projects(first: 50) {
        nodes {
          id name state startDate targetDate progress
          lead { name }
        }
      }
    }
  }
}`;

// Single team — fetch up to 100 projects
const TEAM_QUERY = `
  query GanttTeam($id: String!) {
    team(id: $id) {
      id name key color
      projects(first: 100) {
        nodes {
          id name state startDate targetDate progress
          lead { name }
        }
      }
    }
  }
`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('teamId');
  const apiKey = process.env.LINEAR_API_KEY ?? '';

  if (!apiKey) {
    return NextResponse.json(
      { error: 'LINEAR_API_KEY not configured in .env.local' },
      { status: 500 }
    );
  }

  const body = teamId
    ? JSON.stringify({ query: TEAM_QUERY, variables: { id: teamId } })
    : JSON.stringify({ query: ALL_TEAMS_QUERY });

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body,
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Linear API ${res.status}: ${res.statusText}`, detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Normalise both shapes into a consistent { teams: Team[] } envelope
    if (teamId) {
      const team = data?.data?.team;
      if (!team) {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      }
      return NextResponse.json({ teams: [team] });
    }

    const teams = data?.data?.teams?.nodes ?? [];
    return NextResponse.json({ teams });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
