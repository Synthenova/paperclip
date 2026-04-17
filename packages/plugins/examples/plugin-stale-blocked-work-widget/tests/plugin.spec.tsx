import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { buildRiskDashboard, formatAge, type RiskSummary } from "../src/risk-dashboard.js";
import { DashboardWidget } from "../src/ui/index.js";
import type { Agent, Issue, IssueRelationIssueSummary } from "@paperclipai/shared";

declare global {
  // The UI SDK reads this bridge registry at runtime.
  // The test installs a minimal fake bridge for static rendering.
  var __paperclipPluginBridge__: {
    sdkUi?: Record<string, unknown>;
    react?: { createElement?: (type: unknown, props?: Record<string, unknown> | null) => unknown } | null;
  } | undefined;
}

function makeRelation(partial: Partial<IssueRelationIssueSummary> & Pick<IssueRelationIssueSummary, "id">): IssueRelationIssueSummary {
  return {
    id: partial.id,
    identifier: partial.identifier ?? null,
    title: partial.title ?? "Related issue",
    status: partial.status ?? "todo",
    priority: partial.priority ?? "medium",
    assigneeAgentId: partial.assigneeAgentId ?? null,
    assigneeUserId: partial.assigneeUserId ?? null,
  };
}

function makeIssue(partial: Partial<Issue>): Issue {
  const now = new Date("2026-04-16T12:00:00.000Z");
  return {
    id: partial.id ?? crypto.randomUUID(),
    companyId: partial.companyId ?? "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: partial.title ?? "Untitled",
    description: null,
    status: partial.status ?? "todo",
    priority: partial.priority ?? "medium",
    assigneeAgentId: partial.assigneeAgentId ?? null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    identifier: partial.identifier ?? "PAP-1",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: partial.startedAt ?? now,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    labelIds: [],
    blockedBy: partial.blockedBy ?? [],
    blocks: [],
  };
}

function makeAgent(partial: Partial<Agent>): Agent {
  const now = new Date("2026-04-16T12:00:00.000Z");
  return {
    id: partial.id ?? crypto.randomUUID(),
    companyId: partial.companyId ?? "company-1",
    name: partial.name ?? "Agent One",
    urlKey: partial.urlKey ?? "agent-one",
    role: partial.role ?? "engineer",
    title: partial.title ?? null,
    icon: null,
    status: partial.status ?? "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === "object" && node !== null) {
    const element = node as { props?: { children?: unknown } };
    return collectText(element.props?.children);
  }
  return [];
}

function findHref(node: unknown, href: string): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some((child) => findHref(child, href));
  if (typeof node !== "object") return false;

  const element = node as {
    props?: { href?: string; children?: unknown };
  };
  if (element.props?.href === href) return true;
  return findHref(element.props?.children, href);
}

describe("risk dashboard plugin", () => {
  afterEach(() => {
    delete globalThis.__paperclipPluginBridge__;
    vi.restoreAllMocks();
  });

  it("formats age labels in compact day/hour form", () => {
    const { ageDays, ageLabel } = formatAge(
      new Date("2026-04-15T12:00:00.000Z"),
      new Date("2026-04-16T12:00:00.000Z"),
    );

    expect(ageDays).toBe(1);
    expect(ageLabel).toBe("1 d");
  });

  it("classifies and prioritizes risky issues", () => {
    const now = new Date("2026-04-16T12:00:00.000Z");
    const dashboard = buildRiskDashboard({
      companyId: "company-1",
      now,
      agents: [makeAgent({ id: "agent-1", name: "Avery", title: "Engineer" })],
      issues: [
        makeIssue({
          id: "issue-blocked",
          identifier: "PAP-101",
          title: "Blocked work",
          status: "blocked",
          assigneeAgentId: "agent-1",
          blockedBy: [makeRelation({ id: "dep-1", identifier: "PAP-77", title: "Upstream dependency" })],
          updatedAt: new Date("2026-04-14T12:00:00.000Z"),
        }),
        makeIssue({
          id: "issue-stale",
          identifier: "PAP-102",
          title: "Stale work",
          status: "in_progress",
          assigneeAgentId: "agent-1",
          updatedAt: new Date("2026-04-09T12:00:00.000Z"),
        }),
        makeIssue({
          id: "issue-review",
          identifier: "PAP-103",
          title: "Review waiting",
          status: "in_review",
          updatedAt: new Date("2026-04-12T12:00:00.000Z"),
        }),
      ],
    });

    expect(dashboard.counts).toEqual({
      blocked: 1,
      staleInProgress: 1,
      overdueInReview: 1,
      total: 3,
    });
    expect(dashboard.risks.map((risk) => risk.identifier)).toEqual(["PAP-101", "PAP-103", "PAP-102"]);
    expect(dashboard.risks[0]?.reason).toContain("Blocked by PAP-77");
  });

  it("returns all clear for non-risky work", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: manifest.capabilities,
    });
    await plugin.definition.setup(harness.ctx);

    harness.seed({
      agents: [makeAgent({ id: "agent-1", name: "Avery" })],
      issues: [makeIssue({ id: "issue-safe", identifier: "PAP-201", status: "todo" })],
    });

    const summary = await harness.getData<RiskSummary>("dashboard-risk-summary", { companyId: "company-1" });

    expect(summary.allClear).toBe(true);
    expect(summary.counts.total).toBe(0);
    expect(summary.risks).toHaveLength(0);
  });

  it("renders the risk widget with summary and links", () => {
    globalThis.__paperclipPluginBridge__ = {
      sdkUi: {
        usePluginData: () => ({
          data: {
            generatedAt: "2026-04-16T12:00:00.000Z",
            thresholds: {
              staleInProgressDays: 5,
              overdueInReviewDays: 3,
              maxIssuesToScan: 300,
              maxRiskItems: 6,
            },
            companyId: "company-1",
            counts: {
              blocked: 1,
              staleInProgress: 0,
              overdueInReview: 0,
              total: 1,
            },
            allClear: false,
            risks: [
              {
                bucket: "blocked",
                issueId: "issue-blocked",
                identifier: "PAP-101",
                title: "Blocked work",
                status: "blocked",
                assignee: "Avery (Engineer)",
                ageDays: 2,
                ageLabel: "2 d",
                reason: "Blocked by PAP-77",
                href: "/issues/PAP-101",
              },
            ],
          },
          loading: false,
          error: null,
          refresh: vi.fn(),
        }),
      },
    };

    const tree = DashboardWidget({
      context: {
        companyId: "company-1",
        companyPrefix: "company-1",
        projectId: null,
        entityId: null,
        entityType: null,
        parentEntityId: null,
        userId: null,
      },
    });

    const text = collectText(tree).join(" ");
    expect(text).toContain("Stale and blocked work");
    expect(text).toContain("Refresh");
    expect(text).toContain("PAP-101");
    expect(text).toContain("Blocked work");
    expect(findHref(tree, "/issues/PAP-101")).toBe(true);
  });

  it("renders an all-clear state when no risk data exists", () => {
    globalThis.__paperclipPluginBridge__ = {
      sdkUi: {
        usePluginData: () => ({
          data: {
            generatedAt: "2026-04-16T12:00:00.000Z",
            thresholds: {
              staleInProgressDays: 5,
              overdueInReviewDays: 3,
              maxIssuesToScan: 300,
              maxRiskItems: 6,
            },
            companyId: "company-1",
            counts: {
              blocked: 0,
              staleInProgress: 0,
              overdueInReview: 0,
              total: 0,
            },
            allClear: true,
            risks: [],
          },
          loading: false,
          error: null,
          refresh: vi.fn(),
        }),
      },
    };

    const tree = DashboardWidget({
      context: {
        companyId: "company-1",
        companyPrefix: "company-1",
        projectId: null,
        entityId: null,
        entityType: null,
        parentEntityId: null,
        userId: null,
      },
    });

    expect(collectText(tree).join(" ")).toContain("All clear");
  });
});
