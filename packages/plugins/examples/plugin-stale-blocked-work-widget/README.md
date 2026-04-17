# Stale and Blocked Work Dashboard Widget

Repo-local Paperclip plugin that adds a `dashboardWidget` for scanning company issues for:

- blocked work
- stale in-progress work
- overdue in-review work

## What It Uses

- `issues.read` and `agents.read` in the worker
- `ui.dashboardWidget.register` for the dashboard slot
- the plugin worker bridge via `ctx.data.register("dashboard-risk-summary", ...)`

## Local Install

From the repo root:

```bash
pnpm --filter @paperclipai/plugin-stale-blocked-work-widget build
pnpm paperclipai plugin install ./packages/plugins/examples/plugin-stale-blocked-work-widget
```

## Notes

- Thresholds live in `src/risk-dashboard.ts` and are easy to tune.
- The widget only shows the most actionable risks, not raw issue counts.
- The issue link targets the standard Paperclip issue route: `/issues/:identifier-or-id`.
