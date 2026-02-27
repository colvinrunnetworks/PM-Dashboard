export type MilestoneStatus = 'unstarted' | 'next' | 'overdue' | 'done';

export interface Milestone {
  id: string;
  name: string;
  description: string | null;
  url: string;
  targetDate: string | null;
  progress: number;   // 0.0 – 1.0
  status: MilestoneStatus;
  sortOrder: number;
}

export type ProjectState =
  | 'planned'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'paused';

export type IssueStateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
export type Priority = 0 | 1 | 2 | 3 | 4;

export interface IssueState {
  name: string;
  type: IssueStateType;
}

export interface Issue {
  id: string;
  identifier: string; // e.g. "FORGE-42"
  url: string;        // direct Linear URL
  title: string;
  priority: Priority;
  state: IssueState;
}

export interface ProjectLead {
  name: string;
}

export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';

export interface Project {
  id: string;
  name: string;
  state: ProjectState;
  url: string;
  health: ProjectHealth | null;       // PM-set health in Linear (null if never updated)
  healthUpdatedAt: string | null;     // ISO timestamp, null if never set
  startDate: string | null;
  targetDate: string | null;
  progress: number; // 0.0 – 1.0
  lead: ProjectLead | null;
  issues: {
    nodes: Issue[];
  };
  // projectMilestones fetched separately via /api/milestones to stay under
  // Linear's 10k GraphQL complexity limit; joined client-side by project ID.
  projectMilestones?: {
    nodes: Milestone[];
  };
}

export interface Team {
  id: string;
  name: string;
  key: string;
  color: string; // hex e.g. "#e2b714"
  projects: {
    nodes: Project[];
  };
  // UI-only flag added at settings layer
  isCUI?: boolean;
}

export interface WebhookResponse {
  data: {
    teams: {
      nodes: Team[];
    };
  };
}

export interface PortfolioStats {
  active: number;
  atRisk: number;
  onTrack: number;
  overdue: number;
  completed: number;
}

export interface DeadlineItem {
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  targetDate: string;
  daysUntil: number;
  progress: number;
}

export type DeadlineKind = 'project' | 'milestone';

export interface CombinedDeadlineItem {
  kind: DeadlineKind;
  id: string;              // projectId or milestoneId
  label: string;           // project name or milestone name
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  targetDate: string;
  daysUntil: number;
  progress: number;
  milestoneStatus?: MilestoneStatus;
}

export interface AppSettings {
  webhookBaseUrl: string;
  useTestWebhook: boolean;
  cuiTeamIds: string[];
}
