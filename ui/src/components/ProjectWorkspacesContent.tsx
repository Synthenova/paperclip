import { useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import type { ProjectWorkspaceSummary } from "../lib/project-workspaces-tab";
import { ExecutionWorkspaceCloseDialog } from "./ExecutionWorkspaceCloseDialog";
import { Button } from "@/components/ui/button";
import { ChoosePathButton } from "./PathInstructionsModal";
import { ProjectWorkspaceSummaryCard } from "./ProjectWorkspaceSummaryCard";
import { Loader2, Plus } from "lucide-react";

export function ProjectWorkspacesContent({
  companyId,
  projectId,
  projectRef,
  workspaces,
  summaries,
}: {
  companyId: string;
  projectId: string;
  projectRef: string;
  workspaces: Array<{ id: string; name: string; cwd: string | null; isPrimary: boolean }>;
  summaries: ProjectWorkspaceSummary[];
}) {
  const queryClient = useQueryClient();
  const [runtimeActionKey, setRuntimeActionKey] = useState<string | null>(null);
  const [closingWorkspace, setClosingWorkspace] = useState<{
    id: string;
    name: string;
    status: ExecutionWorkspace["status"];
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceCwd, setNewWorkspaceCwd] = useState("");
  const [newWorkspacePrimary, setNewWorkspacePrimary] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const controlWorkspaceRuntime = useMutation({
    mutationFn: async (input: {
      key: string;
      kind: "project_workspace" | "execution_workspace";
      workspaceId: string;
      action: "start" | "stop" | "restart";
    }) => {
      setRuntimeActionKey(`${input.key}:${input.action}`);
      if (input.kind === "project_workspace") {
        return await projectsApi.controlWorkspaceRuntimeServices(projectId, input.workspaceId, input.action, companyId);
      }
      return await executionWorkspacesApi.controlRuntimeServices(input.workspaceId, input.action);
    },
    onSettled: () => {
      setRuntimeActionKey(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId, { projectId }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
    },
  });
  const deleteWorkspace = useMutation({
    mutationFn: (workspaceId: string) => projectsApi.removeWorkspace(projectId, workspaceId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId, { projectId }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
    },
  });
  const createWorkspace = useMutation({
    mutationFn: (data: Record<string, unknown>) => projectsApi.createWorkspace(projectId, data, companyId),
    onSuccess: () => {
      setCreateOpen(false);
      setNewWorkspaceName("");
      setNewWorkspaceCwd("");
      setNewWorkspacePrimary(false);
      setCreateWorkspaceError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId, { projectId }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
    },
  });

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const submitCreateWorkspace = () => {
    const cwd = newWorkspaceCwd.trim();
    const name = newWorkspaceName.trim();
    if (!cwd) {
      setCreateWorkspaceError("Workspace path is required.");
      return;
    }
    if (!(cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd))) {
      setCreateWorkspaceError("Workspace path must be an absolute path.");
      return;
    }
    setCreateWorkspaceError(null);
    createWorkspace.mutate({
      ...(name ? { name } : {}),
      cwd,
      sourceType: "local_path",
      isPrimary: newWorkspacePrimary,
    });
  };

  const activeSummaries = summaries.filter((summary) => summary.executionWorkspaceStatus !== "cleanup_failed");
  const cleanupFailedSummaries = summaries.filter((summary) => summary.executionWorkspaceStatus === "cleanup_failed");

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Project workspaces</div>
              <p className="text-xs text-muted-foreground">
                Choose which project directories issues can start from. Each workspace can then be used as shared or isolated issue execution.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3"
              onClick={() => {
                setCreateOpen((value) => !value);
                setCreateWorkspaceError(null);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add workspace
            </Button>
          </div>

          {createOpen ? (
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/15 p-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                <label className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Name</div>
                  <input
                    className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
                    value={newWorkspaceName}
                    onChange={(event) => setNewWorkspaceName(event.target.value)}
                    placeholder="frontend"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Local path</div>
                  <input
                    className="w-full rounded border border-border bg-transparent px-2 py-1.5 font-mono text-sm outline-none"
                    value={newWorkspaceCwd}
                    onChange={(event) => setNewWorkspaceCwd(event.target.value)}
                    placeholder="/absolute/path/to/workspace"
                  />
                </label>
                <div className="flex items-end">
                  <ChoosePathButton />
                </div>
              </div>
              <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newWorkspacePrimary}
                  onChange={(event) => setNewWorkspacePrimary(event.target.checked)}
                />
                Set as primary workspace
              </label>
              {createWorkspaceError ? (
                <div className="mt-3 text-xs text-destructive">{createWorkspaceError}</div>
              ) : null}
              {createWorkspace.error instanceof Error ? (
                <div className="mt-3 text-xs text-destructive">{createWorkspace.error.message}</div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="h-8 px-3" onClick={submitCreateWorkspace} disabled={createWorkspace.isPending}>
                  {createWorkspace.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  Create workspace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => {
                    setCreateOpen(false);
                    setNewWorkspaceName("");
                    setNewWorkspaceCwd("");
                    setNewWorkspacePrimary(false);
                    setCreateWorkspaceError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedWorkspaces.map((workspace) => (
              <Link
                key={workspace.id}
                to={`/projects/${projectRef}/workspaces/${workspace.id}`}
                className="rounded-lg border border-border/70 bg-background px-3 py-3 transition-colors hover:bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium text-foreground">{workspace.name}</div>
                  {workspace.isPrimary ? (
                    <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                      Primary
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                  {workspace.cwd ?? "No local path"}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {activeSummaries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
            No execution workspace activity yet.
          </div>
        ) : null}

        <div className="space-y-3">
          {activeSummaries.map((summary) => (
            <ProjectWorkspaceSummaryCard
              key={summary.key}
              projectRef={projectRef}
              summary={summary}
              runtimeActionKey={runtimeActionKey}
              runtimeActionPending={controlWorkspaceRuntime.isPending}
              deletePending={deleteWorkspace.isPending}
              onRuntimeAction={(input) => controlWorkspaceRuntime.mutate(input)}
              onCloseWorkspace={(input) => setClosingWorkspace(input)}
              onDeleteWorkspace={({ id, name, isPrimary }) => {
                const confirmed = window.confirm(
                  isPrimary
                    ? `Delete primary workspace "${name}"? If another workspace exists, Paperclip will promote the next one to primary.`
                    : `Delete workspace "${name}"?`,
                );
                if (!confirmed) return;
                deleteWorkspace.mutate(id);
              }}
            />
          ))}
        </div>
        {cleanupFailedSummaries.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Cleanup attention needed
            </div>
            <div className="space-y-3">
              {cleanupFailedSummaries.map((summary) => (
                <ProjectWorkspaceSummaryCard
                  key={summary.key}
                  projectRef={projectRef}
                  summary={summary}
                  runtimeActionKey={runtimeActionKey}
                  runtimeActionPending={controlWorkspaceRuntime.isPending}
                  deletePending={deleteWorkspace.isPending}
                  onRuntimeAction={(input) => controlWorkspaceRuntime.mutate(input)}
                  onCloseWorkspace={(input) => setClosingWorkspace(input)}
                  onDeleteWorkspace={({ id, name, isPrimary }) => {
                    const confirmed = window.confirm(
                      isPrimary
                        ? `Delete primary workspace "${name}"? If another workspace exists, Paperclip will promote the next one to primary.`
                        : `Delete workspace "${name}"?`,
                    );
                    if (!confirmed) return;
                    deleteWorkspace.mutate(id);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {closingWorkspace ? (
        <ExecutionWorkspaceCloseDialog
          workspaceId={closingWorkspace.id}
          workspaceName={closingWorkspace.name}
          currentStatus={closingWorkspace.status}
          open
          onOpenChange={(open) => {
            if (!open) setClosingWorkspace(null);
          }}
          onClosed={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.list(companyId, { projectId }) });
            queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
            setClosingWorkspace(null);
          }}
        />
      ) : null}
    </>
  );
}
