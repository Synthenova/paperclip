import { z } from "zod";

export const workspaceExplorerPathSchema = z.object({
  path: z.string().trim().optional(),
});

export const createWorkspaceExplorerFileSchema = z.object({
  parentPath: z.string().trim().optional(),
  name: z.string().trim().min(1),
  content: z.string().optional(),
});

export const updateWorkspaceExplorerFileSchema = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
});

export const createWorkspaceExplorerFolderSchema = z.object({
  parentPath: z.string().trim().optional(),
  name: z.string().trim().min(1),
});

export const renameWorkspaceExplorerEntrySchema = z.object({
  path: z.string().trim().min(1),
  newName: z.string().trim().min(1),
});

export const addWorkspaceExplorerRepoSchema = z.object({
  parentPath: z.string().trim().optional(),
  repoUrl: z.string().trim().url(),
  repoRef: z.string().trim().nullable().optional(),
  name: z.string().trim().nullable().optional(),
});

export type WorkspaceExplorerPath = z.infer<typeof workspaceExplorerPathSchema>;
export type CreateWorkspaceExplorerFile = z.infer<typeof createWorkspaceExplorerFileSchema>;
export type UpdateWorkspaceExplorerFile = z.infer<typeof updateWorkspaceExplorerFileSchema>;
export type CreateWorkspaceExplorerFolder = z.infer<typeof createWorkspaceExplorerFolderSchema>;
export type RenameWorkspaceExplorerEntry = z.infer<typeof renameWorkspaceExplorerEntrySchema>;
export type AddWorkspaceExplorerRepo = z.infer<typeof addWorkspaceExplorerRepoSchema>;
