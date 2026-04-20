import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceExplorerDirectory,
  WorkspaceExplorerEntry,
  WorkspaceExplorerFileMeta,
} from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkspaceExplorerApi,
  fetchWorkspaceExplorerTextContent,
  type WorkspaceExplorerClient,
  type WorkspaceExplorerScope,
} from "../api/workspace-explorer";
import { queryKeys } from "../lib/queryKeys";
import { buildFolderArchiveFile } from "../lib/folder-upload";
import { cn } from "../lib/utils";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranchPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

type WorkspaceExplorerProps = {
  scope: WorkspaceExplorerScope;
  title?: string;
  description?: string;
  emptyMessage?: string;
  unavailableMessage?: string;
  className?: string;
};

function scopeKeyForExplorer(scope: WorkspaceExplorerScope) {
  if (scope.type === "agent") return `agent:${scope.agentId}`;
  if (scope.type === "project") return `project:${scope.projectId}:${scope.workspaceId}`;
  return `issue:${scope.issueId}`;
}

function parentPathOf(pathValue: string | null | undefined) {
  const value = pathValue?.trim() ?? "";
  if (!value) return "";
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function isTextLike(entry: WorkspaceExplorerFileMeta | null) {
  return entry?.renderKind === "text" || entry?.renderKind === "markdown";
}

function fileIcon(kind: WorkspaceExplorerEntry["kind"], renderKind: WorkspaceExplorerEntry["renderKind"] | null) {
  if (kind === "dir") return Folder;
  if (renderKind === "image") return FileImage;
  if (renderKind === "markdown") return FileText;
  if (renderKind === "text") return FileCode2;
  if (renderKind === "pdf") return FileType2;
  return FileText;
}

function formatBytes(byteSize: number | null | undefined) {
  if (!byteSize || byteSize <= 0) return "0 B";
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled} className="shadow-none">
      <Icon className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function WorkspaceExplorer({
  scope,
  title = "Workspace",
  description,
  emptyMessage = "No files in this folder.",
  unavailableMessage = "Workspace is unavailable.",
  className,
}: WorkspaceExplorerProps) {
  const queryClient = useQueryClient();
  const scopeKey = useMemo(() => scopeKeyForExplorer(scope), [scope]);
  const explorerApi = useMemo<WorkspaceExplorerClient>(() => createWorkspaceExplorerApi(scope), [scope]);
  const [directories, setDirectories] = useState<Record<string, WorkspaceExplorerDirectory>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [draftText, setDraftText] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showTreePanel, setShowTreePanel] = useState(true);
  const [treePanelWidth, setTreePanelWidth] = useState(280);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetPathRef = useRef<string>("");

  const loadDirectory = useCallback(async (pathValue: string) => {
    const directory = await queryClient.fetchQuery({
      queryKey: queryKeys.workspaceExplorer.directory(scopeKey, pathValue),
      queryFn: () => explorerApi.list(pathValue),
      staleTime: 0,
    });
    setDirectories((current) => ({ ...current, [directory.path]: directory }));
    return directory;
  }, [explorerApi, queryClient, scopeKey]);

  const invalidateDirectory = useCallback(async (pathValue: string) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceExplorer.directory(scopeKey, pathValue) });
    return loadDirectory(pathValue);
  }, [loadDirectory, queryClient, scopeKey]);

  useEffect(() => {
    setDirectories({});
    setExpandedDirs(new Set([""]));
    setSelectedPath("");
    setDraftText(null);
    setEditMode(false);
    setShowTreePanel(true);
    setLoadError(null);
    void loadDirectory("").catch((error) => {
      setLoadError(error instanceof Error ? error.message : "Failed to load workspace");
    });
  }, [loadDirectory, scopeKey]);

  const rootDirectory = directories[""] ?? null;
  const rootName = rootDirectory?.rootName ?? title;

  const entryMap = useMemo(() => {
    const next = new Map<string, WorkspaceExplorerEntry>();
    for (const directory of Object.values(directories)) {
      for (const entry of directory.entries) {
        next.set(entry.path, entry);
      }
    }
    return next;
  }, [directories]);

  const selectedEntry = selectedPath ? (entryMap.get(selectedPath) ?? null) : null;
  const selectedDirectoryPath = useMemo(() => {
    if (!selectedEntry) return "";
    return selectedEntry.kind === "dir" ? selectedEntry.path : parentPathOf(selectedEntry.path);
  }, [selectedEntry]);

  const fileMetaQuery = useQuery({
    queryKey: queryKeys.workspaceExplorer.file(scopeKey, selectedPath),
    queryFn: () => explorerApi.file(selectedPath),
    enabled: Boolean(selectedPath && selectedEntry?.kind === "file"),
    staleTime: 0,
  });

  const textQuery = useQuery({
    queryKey: queryKeys.workspaceExplorer.text(scopeKey, selectedPath),
    queryFn: () => fetchWorkspaceExplorerTextContent(fileMetaQuery.data!.contentPath),
    enabled: Boolean(selectedPath && isTextLike(fileMetaQuery.data ?? null)),
    staleTime: 0,
  });

  useEffect(() => {
    setDraftText(null);
    setEditMode(false);
  }, [selectedPath]);

  useEffect(() => {
    if (!textQuery.data || !isTextLike(fileMetaQuery.data ?? null)) return;
    setDraftText((current) => (current === null ? textQuery.data : current));
  }, [fileMetaQuery.data, textQuery.data]);

  const refreshPath = useCallback(async (pathValue: string) => {
    const directoryPath = parentPathOf(pathValue);
    await invalidateDirectory(directoryPath);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceExplorer.file(scopeKey, pathValue) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceExplorer.text(scopeKey, pathValue) });
  }, [invalidateDirectory, queryClient, scopeKey]);

  const createFileMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["createFile"]>[0]) => explorerApi.createFile(input),
    onSuccess: async (entry) => {
      await invalidateDirectory(parentPathOf(entry.path));
      setExpandedDirs((current) => new Set([...current, parentPathOf(entry.path)]));
      setSelectedPath(entry.path);
    },
  });

  const saveFileMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["saveFile"]>[0]) => explorerApi.saveFile(input),
    onSuccess: async (entry) => {
      await refreshPath(entry.path);
      setEditMode(false);
      setDraftText(null);
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["createFolder"]>[0]) => explorerApi.createFolder(input),
    onSuccess: async (entry) => {
      await invalidateDirectory(parentPathOf(entry.path));
      setExpandedDirs((current) => new Set([...current, entry.path, parentPathOf(entry.path)]));
      setSelectedPath(entry.path);
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["uploadFile"]>[0]) => explorerApi.uploadFile(input),
    onSuccess: async (entry) => {
      await invalidateDirectory(parentPathOf(entry.path));
      setSelectedPath(entry.path);
    },
  });

  const uploadFolderMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["uploadFolder"]>[0]) => explorerApi.uploadFolder(input),
    onSuccess: async (entry) => {
      await invalidateDirectory(parentPathOf(entry.path));
      setExpandedDirs((current) => new Set([...current, entry.path, parentPathOf(entry.path)]));
      setSelectedPath(entry.path);
    },
  });

  const addRepoMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["addRepo"]>[0]) => explorerApi.addRepo(input),
    onSuccess: async (entry) => {
      await invalidateDirectory(parentPathOf(entry.path));
      setExpandedDirs((current) => new Set([...current, entry.path, parentPathOf(entry.path)]));
      setSelectedPath(entry.path);
    },
  });

  const renameMutation = useMutation({
    mutationFn: (input: Parameters<WorkspaceExplorerClient["rename"]>[0]) => explorerApi.rename(input),
    onSuccess: async (entry, variables) => {
      await invalidateDirectory(parentPathOf(variables.path));
      if (selectedPath === variables.path || selectedPath.startsWith(`${variables.path}/`)) {
        const suffix = selectedPath === variables.path ? "" : selectedPath.slice(variables.path.length);
        setSelectedPath(`${entry.path}${suffix}`);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (pathValue: string) => explorerApi.remove(pathValue),
    onSuccess: async (_result, pathValue) => {
      await invalidateDirectory(parentPathOf(pathValue));
      if (selectedPath === pathValue || selectedPath.startsWith(`${pathValue}/`)) {
        setSelectedPath(parentPathOf(pathValue));
      }
    },
  });

  const anyMutationPending =
    createFileMutation.isPending
    || saveFileMutation.isPending
    || createFolderMutation.isPending
    || uploadFileMutation.isPending
    || uploadFolderMutation.isPending
    || addRepoMutation.isPending
    || renameMutation.isPending
    || deleteMutation.isPending;

  const promptForCreateFile = useCallback(async (parentPath: string, markdown = false) => {
    const rawName = window.prompt(markdown ? "New markdown filename" : "New filename", markdown ? "notes.md" : "untitled.txt");
    if (!rawName) return;
    const nextName = markdown && !rawName.toLowerCase().endsWith(".md") ? `${rawName}.md` : rawName;
    await createFileMutation.mutateAsync({
      parentPath,
      name: nextName,
      content: markdown ? "# New document\n" : "",
    });
  }, [createFileMutation]);

  const promptForCreateFolder = useCallback(async (parentPath: string) => {
    const rawName = window.prompt("New folder name", "folder");
    if (!rawName) return;
    await createFolderMutation.mutateAsync({ parentPath, name: rawName });
  }, [createFolderMutation]);

  const promptForRepo = useCallback(async (parentPath: string) => {
    const repoUrl = window.prompt("Repository URL");
    if (!repoUrl) return;
    const name = window.prompt("Target folder name (optional)", "");
    const repoRef = window.prompt("Branch or ref (optional)", "");
    await addRepoMutation.mutateAsync({
      parentPath,
      repoUrl,
      repoRef: repoRef?.trim() ? repoRef.trim() : null,
      name: name?.trim() ? name.trim() : null,
    });
  }, [addRepoMutation]);

  const promptForRename = useCallback(async (pathValue: string, currentName: string) => {
    const nextName = window.prompt("Rename item", currentName);
    if (!nextName || nextName === currentName) return;
    await renameMutation.mutateAsync({ path: pathValue, newName: nextName });
  }, [renameMutation]);

  const confirmDelete = useCallback(async (pathValue: string) => {
    const confirmed = window.confirm(`Delete "${pathValue || rootName}"?`);
    if (!confirmed) return;
    await deleteMutation.mutateAsync(pathValue);
  }, [deleteMutation, rootName]);

  const openFileUploadPicker = useCallback((parentPath: string) => {
    uploadTargetPathRef.current = parentPath;
    fileInputRef.current?.click();
  }, []);

  const openFolderUploadPicker = useCallback((parentPath: string) => {
    uploadTargetPathRef.current = parentPath;
    folderInputRef.current?.click();
  }, []);

  const resolveTargetDirectory = useCallback((pathValue?: string) => {
    if (pathValue !== undefined) return pathValue;
    if (!selectedEntry) return "";
    return selectedEntry.kind === "dir" ? selectedEntry.path : parentPathOf(selectedEntry.path);
  }, [selectedEntry]);

  const toggleDirectory = useCallback(async (pathValue: string) => {
    const nextExpanded = new Set(expandedDirs);
    if (nextExpanded.has(pathValue)) {
      nextExpanded.delete(pathValue);
      setExpandedDirs(nextExpanded);
      return;
    }
    nextExpanded.add(pathValue);
    setExpandedDirs(nextExpanded);
    if (!directories[pathValue]) {
      try {
        await loadDirectory(pathValue);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load folder");
      }
    }
  }, [directories, expandedDirs, loadDirectory]);

  const handleFileUploadInput = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const targetPath = uploadTargetPathRef.current;
    for (const file of Array.from(files)) {
      await uploadFileMutation.mutateAsync({ parentPath: targetPath, file });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadFileMutation]);

  const handleFolderUploadInput = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const archive = await buildFolderArchiveFile(files);
    await uploadFolderMutation.mutateAsync({
      parentPath: uploadTargetPathRef.current,
      name: archive.name,
      file: archive.file,
    });
    if (folderInputRef.current) folderInputRef.current.value = "";
  }, [uploadFolderMutation]);

  const selectedDirectory = selectedEntry?.kind === "dir"
    ? directories[selectedEntry.path] ?? null
    : null;

  const activeActionsPath = resolveTargetDirectory();
  const activeFileMeta = fileMetaQuery.data ?? null;
  const isEditingText = Boolean(editMode && isTextLike(activeFileMeta));

  const handleSaveText = useCallback(async () => {
    if (!selectedPath || draftText === null) return;
    await saveFileMutation.mutateAsync({ path: selectedPath, content: draftText });
  }, [draftText, saveFileMutation, selectedPath]);

  const handleSeparatorDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treePanelWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(220, Math.min(420, startWidth + delta));
      setTreePanelWidth(next);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [treePanelWidth]);

  const renderEntryRow = useCallback((entry: WorkspaceExplorerEntry, depth: number) => {
    const Icon = fileIcon(entry.kind, entry.renderKind);
    const expanded = entry.kind === "dir" && expandedDirs.has(entry.path);
    const selected = selectedPath === entry.path;
    const actionTarget = entry.kind === "dir" ? entry.path : parentPathOf(entry.path);
    const childEntries = entry.kind === "dir" ? (directories[entry.path]?.entries ?? []) : [];
    const row = (
      <div
        className={cn(
          "group flex min-h-9 items-center gap-2 rounded-md px-2 text-sm",
          selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        )}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        {entry.kind === "dir" ? (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-accent"
            onClick={() => void toggleDirectory(entry.path)}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
          onClick={() => {
            setSelectedPath(entry.path);
            if (entry.kind === "dir") void toggleDirectory(entry.path);
            setShowTreePanel(false);
          }}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{entry.name}</span>
        </button>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {entry.kind === "file" ? formatBytes(entry.byteSize) : ""}
        </span>
      </div>
    );

    return (
      <div key={entry.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            {entry.kind === "dir" ? (
              <>
                <ContextMenuItem onSelect={() => void promptForCreateFile(entry.path, true)}>
                  <FilePlus2 className="h-4 w-4" />
                  New document
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void promptForCreateFile(entry.path, false)}>
                  <FileText className="h-4 w-4" />
                  New file
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void promptForCreateFolder(entry.path)}>
                  <FolderPlus className="h-4 w-4" />
                  New folder
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => openFileUploadPicker(entry.path)}>
                  <Upload className="h-4 w-4" />
                  Upload file
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => openFolderUploadPicker(entry.path)}>
                  <FolderOpen className="h-4 w-4" />
                  Upload folder
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void promptForRepo(entry.path)}>
                  <GitBranchPlus className="h-4 w-4" />
                  Add repo
                </ContextMenuItem>
                {entry.path ? (
                  <>
                    <ContextMenuItem onSelect={() => void promptForRename(entry.path, entry.name)}>
                      <Pencil className="h-4 w-4" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => void confirmDelete(entry.path)}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </ContextMenuItem>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <ContextMenuItem onSelect={() => setSelectedPath(entry.path)}>
                  <MoreHorizontal className="h-4 w-4" />
                  Open
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void promptForRename(entry.path, entry.name)}>
                  <Pencil className="h-4 w-4" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={() => void confirmDelete(entry.path)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {entry.kind === "dir" && expanded ? (
          childEntries.length > 0 ? (
            childEntries.map((child: WorkspaceExplorerEntry) => renderEntryRow(child, depth + 1))
          ) : (
            <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${44 + depth * 18}px` }}>
              {emptyMessage}
            </div>
          )
        ) : null}
      </div>
    );
  }, [
    confirmDelete,
    directories,
    emptyMessage,
    expandedDirs,
    openFileUploadPicker,
    openFolderUploadPicker,
    promptForCreateFile,
    promptForCreateFolder,
    promptForRename,
    promptForRepo,
    selectedPath,
    toggleDirectory,
  ]);

  const rootRow = (
    <div
      className={cn(
        "group flex min-h-9 items-center gap-2 rounded-md px-2 text-sm",
        selectedPath === "" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-accent"
        onClick={() => void toggleDirectory("")}
      >
        {expandedDirs.has("") ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        onClick={() => {
          setSelectedPath("");
          void toggleDirectory("");
        }}
      >
        {expandedDirs.has("") ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
        <span className="truncate font-medium">{rootName}</span>
      </button>
    </div>
  );

  const selectedDirectoryEntryCount = selectedDirectory?.entries.length ?? 0;

  return (
    <div className={cn("rounded-2xl border border-border bg-card", className)}>
      <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(event) => void handleFileUploadInput(event)} />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => void handleFolderUploadInput(event)}
      />
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
            {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {anyMutationPending ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating…
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={FilePlus2} label="New document" onClick={() => void promptForCreateFile(activeActionsPath, true)} disabled={anyMutationPending} />
          <ActionButton icon={FileText} label="New file" onClick={() => void promptForCreateFile(activeActionsPath, false)} disabled={anyMutationPending} />
          <ActionButton icon={FolderPlus} label="New folder" onClick={() => void promptForCreateFolder(activeActionsPath)} disabled={anyMutationPending} />
          <ActionButton icon={Upload} label="Upload file" onClick={() => openFileUploadPicker(activeActionsPath)} disabled={anyMutationPending} />
          <ActionButton icon={FolderOpen} label="Upload folder" onClick={() => openFolderUploadPicker(activeActionsPath)} disabled={anyMutationPending} />
          <ActionButton icon={GitBranchPlus} label="Add repo" onClick={() => void promptForRepo(activeActionsPath)} disabled={anyMutationPending} />
          {selectedEntry ? (
            <>
              <ActionButton icon={Pencil} label="Rename" onClick={() => void promptForRename(selectedEntry.path, selectedEntry.name)} disabled={anyMutationPending} />
              <ActionButton icon={Trash2} label="Delete" onClick={() => void confirmDelete(selectedEntry.path)} disabled={anyMutationPending} />
            </>
          ) : null}
        </div>
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      </div>

      <div className={cn("flex gap-0", showTreePanel ? "flex-col lg:flex-row" : "flex-col lg:flex-row")}>
        <div
          className={cn(
            "border-b border-border p-3 lg:border-b-0 lg:border-r",
            !showTreePanel && "hidden lg:block",
          )}
          style={showTreePanel ? undefined : undefined}
        >
          <div className="flex items-center justify-between gap-2 pb-3">
            <h4 className="text-sm font-medium">Files</h4>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 lg:hidden" onClick={() => setShowTreePanel(false)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1 lg:max-h-[70vh] lg:min-h-[32rem] lg:overflow-auto" style={{ width: showTreePanel ? undefined : treePanelWidth }}>
            {rootDirectory ? (
              <>
                <ContextMenu>
                  <ContextMenuTrigger asChild>{rootRow}</ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => void promptForCreateFile("", true)}>
                      <FilePlus2 className="h-4 w-4" />
                      New document
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void promptForCreateFile("", false)}>
                      <FileText className="h-4 w-4" />
                      New file
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void promptForCreateFolder("")}>
                      <FolderPlus className="h-4 w-4" />
                      New folder
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => openFileUploadPicker("")}>
                      <Upload className="h-4 w-4" />
                      Upload file
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => openFolderUploadPicker("")}>
                      <FolderOpen className="h-4 w-4" />
                      Upload folder
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void promptForRepo("")}>
                      <GitBranchPlus className="h-4 w-4" />
                      Add repo
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {expandedDirs.has("") ? (
                  rootDirectory.entries.length > 0 ? (
                    rootDirectory.entries.map((entry: WorkspaceExplorerEntry) => renderEntryRow(entry, 1))
                  ) : (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{emptyMessage}</div>
                  )
                ) : null}
              </>
            ) : loadError ? (
              <p className="text-sm text-muted-foreground">{unavailableMessage}</p>
            ) : (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading workspace…
              </div>
            )}
          </div>
        </div>

        <div className="hidden w-1 shrink-0 cursor-col-resize bg-border/40 lg:block" onMouseDown={handleSeparatorDrag} />

        <div className={cn("min-w-0 flex-1 p-4", showTreePanel && "hidden lg:block")}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Button type="button" size="icon" variant="outline" className="h-7 w-7 lg:hidden" onClick={() => setShowTreePanel(true)}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <h4 className="truncate text-sm font-medium">
                  {selectedEntry?.name ?? rootName}
                </h4>
              </div>
              <p className="text-xs text-muted-foreground">
                {!selectedEntry
                  ? `${rootDirectory?.entries.length ?? 0} item${(rootDirectory?.entries.length ?? 0) === 1 ? "" : "s"} at root`
                  : selectedEntry.kind === "dir"
                    ? `${selectedDirectoryEntryCount} item${selectedDirectoryEntryCount === 1 ? "" : "s"} in folder`
                    : activeFileMeta
                      ? `${activeFileMeta.renderKind} · ${formatBytes(activeFileMeta.byteSize)}`
                      : "Loading file…"}
              </p>
            </div>
            {selectedEntry?.kind === "file" && isTextLike(activeFileMeta) ? (
              <div className="flex items-center gap-2">
                {!editMode ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditMode(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button type="button" size="sm" variant="outline" onClick={() => {
                      setDraftText(textQuery.data ?? "");
                      setEditMode(false);
                    }}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSaveText()} disabled={saveFileMutation.isPending}>
                      {saveFileMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {!selectedEntry ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Select a file or folder to browse this workspace.
            </div>
          ) : selectedEntry.kind === "dir" ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">{selectedEntry.name}</div>
              <p className="mt-2">
                {selectedDirectoryEntryCount === 0
                  ? "This folder is empty."
                  : `${selectedDirectoryEntryCount} item${selectedDirectoryEntryCount === 1 ? "" : "s"} in this folder.`}
              </p>
            </div>
          ) : fileMetaQuery.isLoading || (isTextLike(activeFileMeta) && textQuery.isLoading && draftText === null) ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading file…
            </div>
          ) : fileMetaQuery.error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {fileMetaQuery.error instanceof Error ? fileMetaQuery.error.message : "Failed to load file"}
            </div>
          ) : activeFileMeta?.renderKind === "markdown" ? (
            isEditingText ? (
              <textarea
                className="min-h-[32rem] w-full rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm outline-none"
                value={draftText ?? ""}
                onChange={(event) => setDraftText(event.target.value)}
              />
            ) : (
              <div className="rounded-xl border border-border p-4">
                <MarkdownBody>{textQuery.data ?? ""}</MarkdownBody>
              </div>
            )
          ) : activeFileMeta?.renderKind === "text" ? (
            isEditingText ? (
              <textarea
                className="min-h-[32rem] w-full rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm outline-none"
                value={draftText ?? ""}
                onChange={(event) => setDraftText(event.target.value)}
              />
            ) : (
              <pre className="min-h-[32rem] overflow-auto rounded-xl border border-border bg-muted/20 p-4 font-mono text-sm whitespace-pre-wrap break-words">
                {textQuery.data ?? ""}
              </pre>
            )
          ) : activeFileMeta?.renderKind === "image" ? (
            <div className="flex min-h-[32rem] items-center justify-center rounded-xl border border-border bg-muted/20 p-4">
              <img src={activeFileMeta.contentPath} alt={activeFileMeta.name} className="max-h-[70vh] max-w-full object-contain" />
            </div>
          ) : activeFileMeta?.renderKind === "pdf" ? (
            <div className="min-h-[36rem] overflow-hidden rounded-xl border border-border">
              <iframe title={activeFileMeta.name} src={activeFileMeta.contentPath} className="h-[70vh] w-full" />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{activeFileMeta?.name}</p>
              <p className="mt-2">This file type can’t be rendered in the explorer yet.</p>
              {activeFileMeta ? (
                <div className="mt-4">
                  <a href={activeFileMeta.contentPath} target="_blank" rel="noreferrer" className="text-sm text-foreground underline underline-offset-2">
                    Open file
                  </a>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
