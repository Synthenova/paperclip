import type {
  WorkspaceExplorerDirectory,
  WorkspaceExplorerEntry,
  WorkspaceExplorerFileMeta,
} from "@paperclipai/shared";
import { api } from "./client";

export type WorkspaceExplorerScope =
  | { type: "agent"; agentId: string; companyId?: string }
  | { type: "project"; projectId: string; workspaceId: string; companyId?: string }
  | { type: "issue"; issueId: string };

export interface WorkspaceExplorerClient {
  list(path?: string): Promise<WorkspaceExplorerDirectory>;
  file(path: string): Promise<WorkspaceExplorerFileMeta>;
  createFile(input: { parentPath?: string; name: string; content?: string }): Promise<WorkspaceExplorerEntry>;
  saveFile(input: { path: string; content: string }): Promise<WorkspaceExplorerEntry>;
  createFolder(input: { parentPath?: string; name: string }): Promise<WorkspaceExplorerEntry>;
  uploadFile(input: { parentPath?: string; file: File }): Promise<WorkspaceExplorerEntry>;
  uploadFolder(input: { parentPath?: string; name: string; file: File }): Promise<WorkspaceExplorerEntry>;
  addRepo(input: { parentPath?: string; repoUrl: string; repoRef?: string | null; name?: string | null }): Promise<WorkspaceExplorerEntry>;
  rename(input: { path: string; newName: string }): Promise<WorkspaceExplorerEntry>;
  remove(path: string): Promise<{ ok: true }>;
}

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function workspaceBasePath(scope: WorkspaceExplorerScope) {
  if (scope.type === "agent") {
    return `/agents/${encodeURIComponent(scope.agentId)}/workspace`;
  }
  if (scope.type === "project") {
    return `/projects/${encodeURIComponent(scope.projectId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/workspace`;
  }
  return `/issues/${encodeURIComponent(scope.issueId)}/workspace`;
}

export function createWorkspaceExplorerApi(scope: WorkspaceExplorerScope): WorkspaceExplorerClient {
  const basePath = workspaceBasePath(scope);
  const scopedPath = (path: string) =>
    withCompanyScope(
      path,
      scope.type === "issue" ? undefined : scope.companyId,
    );

  return {
    list: (path = "") => api.get<WorkspaceExplorerDirectory>(scopedPath(`${basePath}/tree?path=${encodeURIComponent(path)}`)),
    file: (path) => api.get<WorkspaceExplorerFileMeta>(scopedPath(`${basePath}/file?path=${encodeURIComponent(path)}`)),
    createFile: (input) => api.post<WorkspaceExplorerEntry>(scopedPath(`${basePath}/file`), input),
    saveFile: (input) => api.put<WorkspaceExplorerEntry>(scopedPath(`${basePath}/file`), input),
    createFolder: (input) => api.post<WorkspaceExplorerEntry>(scopedPath(`${basePath}/folder`), input),
    uploadFile: (input) => {
      const form = new FormData();
      if (input.parentPath) form.append("parentPath", input.parentPath);
      form.append("file", input.file);
      return api.postForm<WorkspaceExplorerEntry>(scopedPath(`${basePath}/upload-file`), form);
    },
    uploadFolder: (input) => {
      const form = new FormData();
      if (input.parentPath) form.append("parentPath", input.parentPath);
      form.append("name", input.name);
      form.append("file", input.file);
      return api.postForm<WorkspaceExplorerEntry>(scopedPath(`${basePath}/upload-folder`), form);
    },
    addRepo: (input) => api.post<WorkspaceExplorerEntry>(scopedPath(`${basePath}/repo`), input),
    rename: (input) => api.patch<WorkspaceExplorerEntry>(scopedPath(`${basePath}/entry`), input),
    remove: (path) => api.delete<{ ok: true }>(scopedPath(`${basePath}/entry?path=${encodeURIComponent(path)}`)),
  };
}

export async function fetchWorkspaceExplorerTextContent(contentPath: string) {
  const response = await fetch(contentPath, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to load file content (${response.status})`);
  }
  return response.text();
}
