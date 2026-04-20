export type WorkspaceExplorerEntryKind = "file" | "dir";

export type WorkspaceExplorerRenderKind =
  | "markdown"
  | "text"
  | "image"
  | "pdf"
  | "binary";

export interface WorkspaceExplorerEntry {
  path: string;
  name: string;
  kind: WorkspaceExplorerEntryKind;
  byteSize: number | null;
  updatedAt: string;
  renderKind: WorkspaceExplorerRenderKind | null;
}

export interface WorkspaceExplorerDirectory {
  rootName: string;
  path: string;
  entries: WorkspaceExplorerEntry[];
}

export interface WorkspaceExplorerFileMeta {
  path: string;
  name: string;
  contentType: string;
  byteSize: number;
  updatedAt: string;
  renderKind: WorkspaceExplorerRenderKind;
  inline: boolean;
  editable: boolean;
  contentPath: string;
}
