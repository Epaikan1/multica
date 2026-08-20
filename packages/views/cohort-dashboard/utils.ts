/**
 * Cohort Dashboard helpers — pure functions over Issue / Project / Agent lists.
 *
 * Kept dependency-free (no @multica/core imports) so the React components
 * can mock the inputs in tests without pulling the whole API surface.
 */
import type { Issue, Project, Agent } from "@multica/core/types";

// Local runtime type — the core/types module doesn't expose a top-level
// `Runtime`; the runtime list endpoint returns a row with `id`, `status`,
// and friends, enough for our heuristic. Loosely typed on purpose so we
// don't break if the real shape grows.
type RuntimeLike = { id: string; status: string };

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface IssueKpis {
  total: number;
  inProgress: number;
  done: number;
  blocked: number;
  completionPct: number;
}

export interface StatusBreakdown {
  status: IssueStatus;
  count: number;
  pct: number;
}

export interface PriorityBreakdown {
  priority: IssuePriority;
  count: number;
}

export interface ProjectProgress {
  id: string;
  title: string;
  icon: string | null;
  status: string;
  issueCount: number;
  doneCount: number;
  progressPct: number;
}

export interface DailyIssueTrend {
  date: string; // ISO YYYY-MM-DD
  created: number;
  done: number;
}

export interface AgentRuntimeStatus {
  agentId: string;
  name: string;
  status: "active" | "idle" | "offline";
  currentTaskTitle: string | null;
  activeTaskCount: number;
}

const ALL_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

const ALL_PRIORITIES: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export function computeIssueKpis(issues: Issue[]): IssueKpis {
  const total = issues.length;
  const done = issues.filter((i) => i.status === "done").length;
  const inProgress = issues.filter((i) => i.status === "in_progress").length;
  const blocked = issues.filter((i) => i.status === "blocked").length;
  const completionPct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
  return { total, inProgress, done, blocked, completionPct };
}

export function statusBreakdown(issues: Issue[]): StatusBreakdown[] {
  const total = issues.length;
  return ALL_STATUSES.map((status) => {
    const count = issues.filter((i) => i.status === status).length;
    const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return { status, count, pct };
  });
}

export function priorityBreakdown(issues: Issue[]): PriorityBreakdown[] {
  return ALL_PRIORITIES.map((priority) => ({
    priority,
    count: issues.filter((i) => (i.priority || "none") === priority).length,
  }));
}

/**
 * Top N projects by issue_count, sorted by status (in_progress first) then count.
 * Reads `issue_count` / `done_count` from the project list endpoint (cheap
 * server-side computed rollup) — no need to fetch all issues per project.
 */
export function topProjects(
  projects: Project[],
  limit = 6,
): ProjectProgress[] {
  const rows: ProjectProgress[] = projects
    .filter((p) => p.issue_count > 0)
    .map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      status: p.status,
      issueCount: p.issue_count,
      doneCount: p.done_count,
      progressPct:
        p.issue_count > 0
          ? Math.round((p.done_count / p.issue_count) * 100)
          : 0,
    }))
    .sort((a, b) => {
      // in_progress before planned
      const sa = a.status === "in_progress" ? 0 : 1;
      const sb = b.status === "in_progress" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return b.issueCount - a.issueCount;
    });
  return rows.slice(0, limit);
}

/**
 * Group issues by their `created_at` date for the last `days` days.
 * Returns one row per day, even when zero issues were created/closed (so the
 * chart x-axis is contiguous).
 */
export function dailyTrend(issues: Issue[], days = 30): DailyIssueTrend[] {
  const now = new Date();
  const out: DailyIssueTrend[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    let created = 0;
    let done = 0;
    for (const issue of issues) {
      if (issue.created_at?.slice(0, 10) === iso) created++;
      if (
        issue.status === "done" &&
        issue.updated_at?.slice(0, 10) === iso
      ) {
        done++;
      }
    }
    out.push({ date: iso, created, done });
  }
  return out;
}

/**
 * Map each agent to a runtime status. We infer:
 * - active : if there is an issue assigned to this agent with status=in_progress
 *            or there is an active agent_task_queue row (not yet available
 *            via API list endpoint, so we approximate with assigned issues).
 * - idle   : at least one runtime online matches this agent's runtime_id /
 *            runtime_kind, but no active task.
 * - offline: no runtime online for this agent (or agent runtime_id missing).
 *
 * Provides a best-effort approximation — the live "claim" state lives in
 * the daemon's agent_task_queue table and would need a dedicated endpoint
 * to be exposed properly. Once that lands we replace this heuristic with
 * the real signal.
 */
export function agentStatuses(
  agents: Agent[],
  issues: Issue[],
  runtimes: RuntimeLike[],
): AgentRuntimeStatus[] {
  const onlineRuntimeIds = new Set(
    runtimes
      .filter((r) => r.status === "online" || r.status === "active")
      .map((r) => r.id),
  );
  return agents.map((agent) => {
    const myInProgress = issues.find(
      (i) =>
        i.assignee_type === "agent" &&
        i.assignee_id === agent.id &&
        i.status === "in_progress",
    );
    const activeCount = issues.filter(
      (i) =>
        i.assignee_type === "agent" &&
        i.assignee_id === agent.id &&
        i.status === "in_progress",
    ).length;
    // Agent.runtime_id may point at a runtime that doesn't exist on the
    // server (e.g. stale config). Fall back to "any online" as a proxy
    // for "platform reachable" so an agent linked to a defunct runtime_id
    // is still surfaced as idle when something else is up.
    const runtimeAvailable =
      onlineRuntimeIds.has(agent.runtime_id) || onlineRuntimeIds.size > 0;
    let status: AgentRuntimeStatus["status"];
    if (myInProgress) {
      status = "active";
    } else if (runtimeAvailable) {
      status = "idle";
    } else {
      status = "offline";
    }
    return {
      agentId: agent.id,
      name: agent.name,
      status,
      currentTaskTitle: myInProgress?.title ?? null,
      activeTaskCount: activeCount,
    };
  });
}

/**
 * Assignment split — counts agents vs members vs unassigned. Used by the
 * "agents-do-the-work" insight tile.
 */
export function assignmentSplit(issues: Issue[]): {
  agent: number;
  member: number;
  unassigned: number;
  agentPct: number;
} {
  const agent = issues.filter((i) => i.assignee_type === "agent").length;
  const member = issues.filter((i) => i.assignee_type === "member").length;
  const unassigned = issues.filter((i) => !i.assignee_type).length;
  const total = agent + member + unassigned;
  const agentPct = total > 0 ? Math.round((agent / total) * 1000) / 10 : 0;
  return { agent, member, unassigned, agentPct };
}
