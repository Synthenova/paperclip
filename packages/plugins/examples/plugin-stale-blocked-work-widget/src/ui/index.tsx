import type { CSSProperties } from "react";
import { usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import type { RiskSummary } from "../risk-dashboard.js";

const shellStyle: CSSProperties = {
  display: "grid",
  gap: "1rem",
  padding: "1rem",
  borderRadius: "1rem",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background:
    "radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 36%), linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))",
  color: "#e2e8f0",
  boxShadow: "0 18px 60px rgba(2, 6, 23, 0.32)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  margin: 0,
};

const subtitleStyle: CSSProperties = {
  margin: "0.25rem 0 0",
  color: "#94a3b8",
  fontSize: "0.88rem",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(9.5rem, 1fr))",
  gap: "0.5rem",
};

const summaryCardStyle: CSSProperties = {
  borderRadius: "0.85rem",
  padding: "0.75rem",
  background: "rgba(15, 23, 42, 0.66)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
};

const riskListStyle: CSSProperties = {
  display: "grid",
  gap: "0.65rem",
};

const riskCardStyle: CSSProperties = {
  display: "grid",
  gap: "0.4rem",
  borderRadius: "0.9rem",
  padding: "0.85rem",
  background: "rgba(15, 23, 42, 0.72)",
  border: "1px solid rgba(148, 163, 184, 0.2)",
};

const mutedStyle: CSSProperties = { color: "#94a3b8" };

const buttonStyle: CSSProperties = {
  border: "1px solid rgba(96, 165, 250, 0.35)",
  background: "rgba(30, 41, 59, 0.88)",
  color: "#dbeafe",
  padding: "0.4rem 0.75rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
  cursor: "pointer",
};

const bucketStyles: Record<string, CSSProperties> = {
  blocked: {
    color: "#fecaca",
    background: "rgba(153, 27, 27, 0.38)",
  },
  stale_in_progress: {
    color: "#fde68a",
    background: "rgba(161, 98, 7, 0.34)",
  },
  overdue_in_review: {
    color: "#bfdbfe",
    background: "rgba(30, 64, 175, 0.32)",
  },
};

function bucketLabel(bucket: string): string {
  switch (bucket) {
    case "blocked":
      return "Blocked";
    case "stale_in_progress":
      return "Stale in progress";
    case "overdue_in_review":
      return "Overdue in review";
    default:
      return bucket;
  }
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={summaryCardStyle}>
      <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{value}</div>
      <div style={{ ...mutedStyle, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

export function DashboardWidget({ context }: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<RiskSummary>(
    "dashboard-risk-summary",
    context.companyId ? { companyId: context.companyId } : undefined,
  );

  if (!context.companyId) {
    return (
      <section style={shellStyle}>
        <header style={headerStyle}>
          <div>
            <h2 style={titleStyle}>Stale and blocked work</h2>
            <p style={subtitleStyle}>Select a company to scan for risky issues.</p>
          </div>
        </header>
      </section>
    );
  }

  if (loading) {
    return (
      <section style={shellStyle}>
        <header style={headerStyle}>
          <div>
            <h2 style={titleStyle}>Stale and blocked work</h2>
            <p style={subtitleStyle}>Scanning company issues for risk signals.</p>
          </div>
        </header>
        <div style={mutedStyle}>Loading dashboard risk summary…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section style={shellStyle}>
        <header style={headerStyle}>
          <div>
            <h2 style={titleStyle}>Stale and blocked work</h2>
            <p style={subtitleStyle}>Unable to load the latest issue risk summary.</p>
          </div>
        </header>
        <div style={{ color: "#fecaca" }}>{error.message}</div>
      </section>
    );
  }

  const dashboard = data ?? null;

  return (
    <section style={shellStyle}>
      <header style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Stale and blocked work</h2>
          <p style={subtitleStyle}>
            Company-scoped scan of blocked, stale in-progress, and overdue in-review issues.
          </p>
        </div>
        <button type="button" style={buttonStyle} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {!dashboard || dashboard.allClear ? (
        <div style={{ ...riskCardStyle, borderColor: "rgba(74, 222, 128, 0.35)" }}>
          <strong style={{ color: "#bbf7d0" }}>All clear</strong>
          <div style={mutedStyle}>
            No blocked, stale in-progress, or overdue in-review issues were found in the current company.
          </div>
        </div>
      ) : (
        <>
          <div style={summaryGridStyle}>
            <SummaryStat label="Blocked" value={dashboard.counts.blocked} />
            <SummaryStat label="Stale in progress" value={dashboard.counts.staleInProgress} />
            <SummaryStat label="Overdue in review" value={dashboard.counts.overdueInReview} />
            <SummaryStat label="Total risky" value={dashboard.counts.total} />
          </div>

          <div style={riskListStyle}>
            {dashboard.risks.map((risk) => (
              <a
                key={risk.issueId}
                href={risk.href}
                target="_blank"
                rel="noreferrer"
                style={{ ...riskCardStyle, textDecoration: "none", color: "inherit" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <strong>{risk.identifier}</strong>
                  <span
                    style={{
                      ...bucketStyles[risk.bucket],
                      padding: "0.2rem 0.5rem",
                      borderRadius: "999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    {bucketLabel(risk.bucket)}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{risk.title}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem", fontSize: "0.8rem", ...mutedStyle }}>
                  <span>Status: {risk.status}</span>
                  <span>Assignee: {risk.assignee}</span>
                  <span>Age: {risk.ageLabel}</span>
                </div>
                <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>{risk.reason}</div>
              </a>
            ))}
          </div>

          {dashboard.counts.total > dashboard.risks.length ? (
            <div style={{ ...mutedStyle, fontSize: "0.82rem" }}>
              Showing {dashboard.risks.length} of {dashboard.counts.total} risky issues.
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
