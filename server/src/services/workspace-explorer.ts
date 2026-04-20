import { execFile } from "node:child_process";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import type {
  WorkspaceExplorerDirectory,
  WorkspaceExplorerEntry,
  WorkspaceExplorerFileMeta,
  WorkspaceExplorerRenderKind,
} from "@paperclipai/shared";
import { HttpError, badRequest, conflict, notFound, unprocessable } from "../errors.js";
import {
  SVG_CONTENT_TYPE,
  isInlineAttachmentContentType,
  normalizeContentType,
} from "../attachment-types.js";

const execFileAsync = promisify(execFile);

type ExplorerRoot = {
  rootDir: string;
  rootName: string;
  ensureExists?: boolean;
};

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".env",
  ".gitignore",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".lua",
  ".mjs",
  ".md",
  ".markdown",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function readUint16(source: Uint8Array, offset: number) {
  return source[offset]! | (source[offset + 1]! << 8);
}

function readUint32(source: Uint8Array, offset: number) {
  return (
    source[offset]! |
    (source[offset + 1]! << 8) |
    (source[offset + 2]! << 16) |
    (source[offset + 3]! << 24)
  ) >>> 0;
}

function normalizeRelativeArchivePath(pathValue: string) {
  return pathValue
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}

async function readStoredZipArchive(source: Uint8Array): Promise<{
  rootPath: string | null;
  files: Array<{ relativePath: string; bytes: Uint8Array }>;
}> {
  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  let offset = 0;

  while (offset + 4 <= source.length) {
    const signature = readUint32(source, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw unprocessable("Invalid folder archive: unsupported local file header.");
    }
    if (offset + 30 > source.length) {
      throw unprocessable("Invalid folder archive: truncated local file header.");
    }

    const compressionMethod = readUint16(source, offset + 8);
    if (compressionMethod !== 0) {
      throw unprocessable("Unsupported folder archive: only uncompressed zip uploads are supported.");
    }
    const compressedSize = readUint32(source, offset + 18);
    const fileNameLength = readUint16(source, offset + 26);
    const extraFieldLength = readUint16(source, offset + 28);
    const nameOffset = offset + 30;
    const bodyOffset = nameOffset + fileNameLength + extraFieldLength;
    const bodyEnd = bodyOffset + compressedSize;
    if (bodyEnd > source.length) {
      throw unprocessable("Invalid folder archive: truncated file contents.");
    }

    const rawPath = new TextDecoder().decode(source.slice(nameOffset, nameOffset + fileNameLength));
    const normalizedPath = normalizeRelativeArchivePath(rawPath);
    const isDirectoryEntry = /\/$/.test(rawPath.replace(/\\/g, "/"));
    if (normalizedPath && !isDirectoryEntry) {
      entries.push({
        path: normalizedPath,
        bytes: source.slice(bodyOffset, bodyEnd),
      });
    }

    offset = bodyEnd;
  }

  const firstParts = entries.map((entry) => entry.path.split("/").filter(Boolean)).filter((parts) => parts.length > 0);
  const candidateRoot = firstParts[0]?.[0] ?? null;
  const rootPath =
    candidateRoot && firstParts.every((parts) => parts.length > 1 && parts[0] === candidateRoot) ? candidateRoot : null;

  return {
    rootPath,
    files: entries.map((entry) => ({
      relativePath:
        rootPath && entry.path.startsWith(`${rootPath}/`) ? entry.path.slice(rootPath.length + 1) : entry.path,
      bytes: entry.bytes,
    })),
  };
}

function sanitizeFileName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw unprocessable("Name is required");
  if (trimmed === "." || trimmed === "..") throw unprocessable("Invalid name");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw unprocessable("Names cannot include path separators");
  }
  return trimmed;
}

function normalizeRelativePath(input: string | null | undefined) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";
  const normalized = trimmed
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes("..")) throw badRequest("Path traversal is not allowed");
  return normalized;
}

async function ensureRoot(root: ExplorerRoot) {
  if (!root.ensureExists) return;
  await fs.mkdir(root.rootDir, { recursive: true });
}

async function assertPathInsideRoot(candidatePath: string, rootDir: string) {
  const rootRealPath = await fs.realpath(rootDir).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") throw notFound("Workspace root not found");
    throw err;
  });
  const candidateRealPath = await fs.realpath(candidatePath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") throw notFound("Path not found");
    throw err;
  });
  const relative = path.relative(rootRealPath, candidateRealPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(403, "Requested path is outside the workspace root");
  }
  return { rootRealPath, candidateRealPath };
}

async function resolveExistingPath(root: ExplorerRoot, relativePath: string) {
  await ensureRoot(root);
  const normalized = normalizeRelativePath(relativePath);
  const candidatePath = normalized ? path.resolve(root.rootDir, normalized) : root.rootDir;
  return assertPathInsideRoot(candidatePath, root.rootDir);
}

async function resolveParentDirectory(root: ExplorerRoot, parentPath: string | null | undefined) {
  await ensureRoot(root);
  const normalizedParent = normalizeRelativePath(parentPath);
  const candidatePath = normalizedParent ? path.resolve(root.rootDir, normalizedParent) : root.rootDir;
  const { rootRealPath, candidateRealPath } = await assertPathInsideRoot(candidatePath, root.rootDir);
  const stat = await fs.stat(candidateRealPath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") throw notFound("Parent directory not found");
    throw err;
  });
  if (!stat.isDirectory()) throw unprocessable("Parent path is not a directory");
  return { rootRealPath, parentRealPath: candidateRealPath };
}

function inferContentType(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".env") || lower.endsWith(".gitignore")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (lower.endsWith(".toml") || lower.endsWith(".ini") || lower.endsWith(".cfg") || lower.endsWith(".conf")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".jsx")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".py") || lower.endsWith(".sh") || lower.endsWith(".sql") || lower.endsWith(".rb") || lower.endsWith(".go")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".svg")) return SVG_CONTENT_TYPE;
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function inferRenderKind(filePath: string, contentType: string): WorkspaceExplorerRenderKind {
  const ext = path.extname(filePath).toLowerCase();
  if (contentType === "text/markdown; charset=utf-8") return "markdown";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (
    contentType.startsWith("text/")
    || contentType === "application/json"
    || TEXT_EXTENSIONS.has(ext)
  ) {
    return "text";
  }
  return "binary";
}

function buildEntry(input: {
  relativePath: string;
  stat: { isDirectory(): boolean; size: number; mtime: Date };
}): WorkspaceExplorerEntry {
  const name = input.relativePath.split("/").filter(Boolean).pop() ?? input.relativePath;
  const kind = input.stat.isDirectory() ? "dir" as const : "file" as const;
  const contentType = kind === "file" ? normalizeContentType(inferContentType(name)) : null;
  return {
    path: input.relativePath,
    name,
    kind,
    byteSize: kind === "file" ? input.stat.size : null,
    updatedAt: input.stat.mtime.toISOString(),
    renderKind: contentType ? inferRenderKind(name, contentType) : null,
  };
}

function buildFileMeta(input: {
  relativePath: string;
  stat: { size: number; mtime: Date };
  contentPath: string;
}): WorkspaceExplorerFileMeta {
  const name = input.relativePath.split("/").filter(Boolean).pop() ?? input.relativePath;
  const contentType = normalizeContentType(inferContentType(name));
  const renderKind = inferRenderKind(name, contentType);
  return {
    path: input.relativePath,
    name,
    contentType,
    byteSize: input.stat.size,
    updatedAt: input.stat.mtime.toISOString(),
    renderKind,
    inline: isInlineAttachmentContentType(contentType) || renderKind === "text" || renderKind === "markdown",
    editable: renderKind === "text" || renderKind === "markdown",
    contentPath: input.contentPath,
  };
}

function repoFolderName(repoUrl: string) {
  const withoutTrailingSlash = repoUrl.replace(/\/+$/, "");
  const base = withoutTrailingSlash.split("/").pop() ?? "repo";
  const normalized = base.replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "repo";
}

async function ensureDestinationAvailable(destination: string) {
  try {
    await fs.access(destination);
    throw conflict("A file or folder with that name already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function listDirectory(root: ExplorerRoot, relativePath: string): Promise<WorkspaceExplorerDirectory> {
  const { rootRealPath, candidateRealPath } = await resolveExistingPath(root, relativePath);
  const stat = await fs.stat(candidateRealPath);
  if (!stat.isDirectory()) throw unprocessable("Path is not a directory");
  const dirEntries = await fs.readdir(candidateRealPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirEntries.map(async (entry) => {
      const entryPath = path.resolve(candidateRealPath, entry.name);
      const relative = path.relative(rootRealPath, entryPath).replace(/\\/g, "/");
      const entryStat = await fs.stat(entryPath);
      return buildEntry({ relativePath: relative, stat: entryStat });
    }),
  );
  entries.sort((left: WorkspaceExplorerEntry, right: WorkspaceExplorerEntry) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return {
    rootName: root.rootName,
    path: normalizeRelativePath(relativePath),
    entries,
  };
}

async function getFileMeta(root: ExplorerRoot, relativePath: string, contentPath: string) {
  const { rootRealPath, candidateRealPath } = await resolveExistingPath(root, relativePath);
  const stat = await fs.stat(candidateRealPath);
  if (!stat.isFile()) throw unprocessable("Path is not a file");
  const relative = path.relative(rootRealPath, candidateRealPath).replace(/\\/g, "/");
  return buildFileMeta({ relativePath: relative, stat, contentPath });
}

async function streamFile(root: ExplorerRoot, relativePath: string): Promise<{
  stream: Readable;
  meta: WorkspaceExplorerFileMeta;
}> {
  const { rootRealPath, candidateRealPath } = await resolveExistingPath(root, relativePath);
  const stat = await fs.stat(candidateRealPath);
  if (!stat.isFile()) throw unprocessable("Path is not a file");
  const relative = path.relative(rootRealPath, candidateRealPath).replace(/\\/g, "/");
  const meta = buildFileMeta({ relativePath: relative, stat, contentPath: "" });
  return {
    stream: createReadStream(candidateRealPath),
    meta,
  };
}

async function createFile(root: ExplorerRoot, input: {
  parentPath?: string | null;
  name: string;
  content?: string;
}) {
  const fileName = sanitizeFileName(input.name);
  const { rootRealPath, parentRealPath } = await resolveParentDirectory(root, input.parentPath);
  const destination = path.resolve(parentRealPath, fileName);
  const relative = path.relative(rootRealPath, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "Destination is outside the workspace root");
  await ensureDestinationAvailable(destination);
  await fs.writeFile(destination, input.content ?? "", "utf8");
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: relative.replace(/\\/g, "/"), stat });
}

async function updateFile(root: ExplorerRoot, input: {
  path: string;
  content: string;
}) {
  const { rootRealPath, candidateRealPath } = await resolveExistingPath(root, input.path);
  const stat = await fs.stat(candidateRealPath);
  if (!stat.isFile()) throw unprocessable("Path is not a file");
  await fs.writeFile(candidateRealPath, input.content, "utf8");
  const nextStat = await fs.stat(candidateRealPath);
  const relative = path.relative(rootRealPath, candidateRealPath).replace(/\\/g, "/");
  return buildEntry({ relativePath: relative, stat: nextStat });
}

async function createFolder(root: ExplorerRoot, input: {
  parentPath?: string | null;
  name: string;
}) {
  const folderName = sanitizeFileName(input.name);
  const { rootRealPath, parentRealPath } = await resolveParentDirectory(root, input.parentPath);
  const destination = path.resolve(parentRealPath, folderName);
  const relative = path.relative(rootRealPath, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "Destination is outside the workspace root");
  await ensureDestinationAvailable(destination);
  await fs.mkdir(destination, { recursive: false });
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: relative.replace(/\\/g, "/"), stat });
}

async function uploadFile(root: ExplorerRoot, input: {
  parentPath?: string | null;
  fileName: string;
  bytes: Buffer;
}) {
  const { rootRealPath, parentRealPath } = await resolveParentDirectory(root, input.parentPath);
  const destination = path.resolve(parentRealPath, sanitizeFileName(input.fileName));
  const relative = path.relative(rootRealPath, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "Destination is outside the workspace root");
  await ensureDestinationAvailable(destination);
  await fs.writeFile(destination, input.bytes);
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: relative.replace(/\\/g, "/"), stat });
}

async function uploadFolder(root: ExplorerRoot, input: {
  parentPath?: string | null;
  folderName: string;
  archiveBytes: Uint8Array;
}) {
  const { rootRealPath, parentRealPath } = await resolveParentDirectory(root, input.parentPath);
  const destination = path.resolve(parentRealPath, sanitizeFileName(input.folderName));
  const relative = path.relative(rootRealPath, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "Destination is outside the workspace root");
  await ensureDestinationAvailable(destination);
  const archive = await readStoredZipArchive(input.archiveBytes);
  await fs.mkdir(destination, { recursive: true });
  for (const file of archive.files) {
    const normalized = normalizeRelativeArchivePath(file.relativePath);
    if (!normalized) continue;
    const filePath = path.resolve(destination, normalized);
    const nestedRelative = path.relative(destination, filePath);
    if (nestedRelative.startsWith("..") || path.isAbsolute(nestedRelative)) {
      throw conflict("Folder archive contained an unsafe path");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.bytes);
  }
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: relative.replace(/\\/g, "/"), stat });
}

async function addRepo(root: ExplorerRoot, input: {
  parentPath?: string | null;
  repoUrl: string;
  repoRef?: string | null;
  name?: string | null;
}) {
  const { rootRealPath, parentRealPath } = await resolveParentDirectory(root, input.parentPath);
  const destination = path.resolve(parentRealPath, sanitizeFileName(input.name?.trim() || repoFolderName(input.repoUrl)));
  const relative = path.relative(rootRealPath, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "Destination is outside the workspace root");
  await ensureDestinationAvailable(destination);
  await execFileAsync("git", ["clone", input.repoUrl, destination]);
  if (input.repoRef?.trim()) {
    await execFileAsync("git", ["-C", destination, "checkout", input.repoRef.trim()]);
  }
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: relative.replace(/\\/g, "/"), stat });
}

async function renameEntry(root: ExplorerRoot, input: {
  relativePath: string;
  newName: string;
}) {
  if (!normalizeRelativePath(input.relativePath)) throw unprocessable("Root folder cannot be renamed");
  const { rootRealPath, candidateRealPath } = await resolveExistingPath(root, input.relativePath);
  const destination = path.resolve(path.dirname(candidateRealPath), sanitizeFileName(input.newName));
  const destinationRelative = path.relative(rootRealPath, destination);
  if (destinationRelative.startsWith("..") || path.isAbsolute(destinationRelative)) {
    throw new HttpError(403, "Destination is outside the workspace root");
  }
  if (destination === candidateRealPath) throw unprocessable("New name must be different");
  await ensureDestinationAvailable(destination);
  await fs.rename(candidateRealPath, destination);
  const stat = await fs.stat(destination);
  return buildEntry({ relativePath: destinationRelative.replace(/\\/g, "/"), stat });
}

async function deleteEntry(root: ExplorerRoot, relativePath: string) {
  if (!normalizeRelativePath(relativePath)) throw unprocessable("Root folder cannot be deleted");
  const { candidateRealPath } = await resolveExistingPath(root, relativePath);
  const stat = await fs.stat(candidateRealPath);
  if (stat.isDirectory()) {
    await fs.rm(candidateRealPath, { recursive: true, force: true });
  } else {
    await fs.unlink(candidateRealPath);
  }
}

export const workspaceExplorerService = {
  listDirectory,
  getFileMeta,
  streamFile,
  createFile,
  updateFile,
  createFolder,
  uploadFile,
  uploadFolder,
  addRepo,
  renameEntry,
  deleteEntry,
};
