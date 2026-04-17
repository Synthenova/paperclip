import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import manifest from "./manifest.js";
import { buildRiskDashboard, RISK_CONFIG, type RiskSummary } from "./risk-dashboard.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register("dashboard-risk-summary", async (params: Record<string, unknown>) => {
      const companyId = typeof params.companyId === "string" ? params.companyId.trim() : "";
      if (!companyId) {
        return emptySummary("", new Date());
      }

      const [issues, agents] = await Promise.all([
        ctx.issues.list({ companyId, limit: RISK_CONFIG.maxIssuesToScan, offset: 0 }),
        ctx.agents.list({ companyId }),
      ]);

      return buildRiskDashboard({
        companyId,
        issues,
        agents,
      });
    });
  },

  async onHealth() {
    return { status: "ok", message: "Stale and blocked work widget is ready" };
  },
});

function emptySummary(companyId: string, now: Date): RiskSummary {
  return {
    generatedAt: now.toISOString(),
    thresholds: RISK_CONFIG,
    companyId,
    counts: {
      blocked: 0,
      staleInProgress: 0,
      overdueInReview: 0,
      total: 0,
    },
    allClear: true,
    risks: [],
  };
}

export default plugin;
runWorker(plugin, import.meta.url);
