import type { Agent, Issue } from "@paperclipai/shared";

export const RISK_CONFIG = {
  staleInProgressDays: 5,
  overdueInReviewDays: 3,
  maxIssuesToScan: 300,
  maxRiskItems: 6,
} as const;

export type RiskBucket = "blocked" | "stale_in_progress" | "overdue_in_review";

export interface RiskItem {
  bucket: RiskBucket;
  issueId: string;
  identifier: string;
  title: string;
  status: Issue["status"];
  assignee: string;
  ageDays: number;
  ageLabel: string;
  reason: string;
  href: string;
}

export interface RiskSummary {
  generatedAt: string;
  thresholds: typeof RISK_CONFIG;
  companyId: string;
  counts: {
    blocked: number;
    staleInProgress: number;
    overdueInReview: number;
    total: number;
  };
  allClear: boolean;
  risks: RiskItem[];
}

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatAge(referenceTime: Date, now = new Date()): { ageDays: number; ageLabel: string } {
  const diffMs = Math.max(0, now.getTime() - referenceTime.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const ageDays = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (ageDays > 0) parts.push(pluralize(ageDays, "d"));
  if (hours > 0 && parts.length < 2) parts.push(pluralize(hours, "h"));
  if (parts.length === 0) parts.push(pluralize(minutes, "m"));

  return {
    ageDays,
    ageLabel: parts.join(" "),
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function issueReference(issue: Issue): string {
  return issue.identifier ?? issue.id;
}

function assigneeLabel(issue: Issue, agentById: Map<string, Agent>): string {
  if (!issue.assigneeAgentId) return "Unassigned";
  const agent = agentById.get(issue.assigneeAgentId);
  if (!agent) return "Unknown agent";
  return agent.title ? `${agent.name} (${agent.title})` : agent.name;
}

function issueTouchedAt(issue: Issue): Date | null {
  return (
    toDate(issue.lastActivityAt) ??
    toDate(issue.myLastTouchAt) ??
    toDate(issue.updatedAt) ??
    toDate(issue.startedAt) ??
    toDate(issue.createdAt)
  );
}

function blockedReason(issue: Issue): string {
  const blockedBy = issue.blockedBy ?? [];
  if (blockedBy.length === 0) return "Issue is marked blocked";

  const names = blockedBy.slice(0, 2).map((blocked) => blocked.identifier ?? blocked.title ?? blocked.id);
  const suffix = blockedBy.length > names.length ? `, +${blockedBy.length - names.length} more` : "";
  return `Blocked by ${names.join(", ")}${suffix}`;
}

function classifyIssue(issue: Issue, ageDays: number): RiskBucket | null {
  if (issue.status === "blocked" || (issue.blockedBy?.length ?? 0) > 0) {
    return "blocked";
  }

  if (issue.status === "in_progress" && ageDays >= RISK_CONFIG.staleInProgressDays) {
    return "stale_in_progress";
  }

  if (issue.status === "in_review" && ageDays >= RISK_CONFIG.overdueInReviewDays) {
    return "overdue_in_review";
  }

  return null;
}

function severityRank(bucket: RiskBucket): number {
  switch (bucket) {
    case "blocked":
      return 0;
    case "overdue_in_review":
      return 1;
    case "stale_in_progress":
      return 2;
  }
}

export function buildRiskDashboard(input: {
  companyId: string;
  issues: Issue[];
  agents: Agent[];
  now?: Date;
}): RiskSummary {
  const now = input.now ?? new Date();
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const counts = {
    blocked: 0,
    staleInProgress: 0,
    overdueInReview: 0,
    total: 0,
  };
  const risks: RiskItem[] = [];

  for (const issue of input.issues) {
    const touchedAt = issueTouchedAt(issue);
    if (!touchedAt) continue;
    const { ageDays, ageLabel } = formatAge(touchedAt, now);
    const bucket = classifyIssue(issue, ageDays);
    if (!bucket) continue;

    if (bucket === "blocked") counts.blocked += 1;
    if (bucket === "stale_in_progress") counts.staleInProgress += 1;
    if (bucket === "overdue_in_review") counts.overdueInReview += 1;
    counts.total += 1;

    const reference = issueReference(issue);
    risks.push({
      bucket,
      issueId: issue.id,
      identifier: reference,
      title: issue.title,
      status: issue.status,
      assignee: assigneeLabel(issue, agentById),
      ageDays,
      ageLabel,
      reason:
        bucket === "blocked"
          ? blockedReason(issue)
          : bucket === "stale_in_progress"
            ? `No updates for ${ageLabel} while in progress`
            : `In review for ${ageLabel}, past the ${RISK_CONFIG.overdueInReviewDays}d threshold`,
      href: `/issues/${encodeURIComponent(reference)}`,
    });
  }

  const sortedRisks = risks
    .sort((a, b) => {
      const severityDelta = severityRank(a.bucket) - severityRank(b.bucket);
      if (severityDelta !== 0) return severityDelta;
      if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
      return a.identifier.localeCompare(b.identifier);
    })
    .slice(0, RISK_CONFIG.maxRiskItems);

  return {
    generatedAt: now.toISOString(),
    thresholds: RISK_CONFIG,
    companyId: input.companyId,
    counts,
    allClear: counts.total === 0,
    risks: sortedRisks,
  };
}
