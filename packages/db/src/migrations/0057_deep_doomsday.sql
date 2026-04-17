CREATE TABLE "issue_reference_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"asset_id" uuid,
	"repo_url" text,
	"repo_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_reference_files" ADD CONSTRAINT "issue_reference_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_files" ADD CONSTRAINT "issue_reference_files_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_files" ADD CONSTRAINT "issue_reference_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference_files" ADD CONSTRAINT "issue_reference_files_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_reference_files_company_issue_idx" ON "issue_reference_files" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_reference_files_company_kind_idx" ON "issue_reference_files" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "issue_reference_files_issue_name_idx" ON "issue_reference_files" USING btree ("issue_id","name");