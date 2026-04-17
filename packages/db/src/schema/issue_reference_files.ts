import { pgTable, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { assets } from "./assets.js";
import { agents } from "./agents.js";

export const issueReferenceFiles = pgTable(
  "issue_reference_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    repoUrl: text("repo_url"),
    repoRef: text("repo_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_reference_files_company_issue_idx").on(table.companyId, table.issueId),
    companyKindIdx: index("issue_reference_files_company_kind_idx").on(table.companyId, table.kind),
    issueNameIdx: index("issue_reference_files_issue_name_idx").on(table.issueId, table.name),
  }),
);
