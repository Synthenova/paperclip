import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.plugin-stale-blocked-work-widget",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Stale and Blocked Work Dashboard Widget",
  description:
    "A dashboard widget that surfaces blocked, stale in-progress, and overdue in-review issues.",
  author: "Paperclip",
  categories: ["ui"],
  capabilities: ["issues.read", "agents.read", "ui.dashboardWidget.register"],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "risk-radar",
        displayName: "Stale and Blocked Work",
        exportName: "DashboardWidget",
      },
    ],
  },
};

export default manifest;
