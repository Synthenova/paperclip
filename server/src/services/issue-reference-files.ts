import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { buffer as readStreamBuffer } from "node:stream/consumers";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, issueReferenceFiles, issues } from "@paperclipai/db";
import type { IssueReferenceFile } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import type { StorageService } from "../storage/types.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";

const execFileAsync = promisify(execFile);

function safePathSegment(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? "")
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function inferDocumentFilename(input: { key: string; title: string | null }) {
  const base = safePathSegment(input.title ?? input.key, safePathSegment(input.key, "document"));
  return base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
}

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

function normalizeArchivePath(pathValue: string) {
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
      throw new Error("Invalid folder archive: unsupported local file header.");
    }
    if (offset + 30 > source.length) {
      throw new Error("Invalid folder archive: truncated local file header.");
    }

    const compressionMethod = readUint16(source, offset + 8);
    if (compressionMethod !== 0) {
      throw new Error("Unsupported folder archive: only uncompressed zip uploads are supported.");
    }
    const compressedSize = readUint32(source, offset + 18);
    const fileNameLength = readUint16(source, offset + 26);
    const extraFieldLength = readUint16(source, offset + 28);
    const nameOffset = offset + 30;
    const bodyOffset = nameOffset + fileNameLength + extraFieldLength;
    const bodyEnd = bodyOffset + compressedSize;
    if (bodyEnd > source.length) {
      throw new Error("Invalid folder archive: truncated file contents.");
    }

    const rawPath = new TextDecoder().decode(source.slice(nameOffset, nameOffset + fileNameLength));
    const normalizedPath = normalizeArchivePath(rawPath);
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

async function ensureIssueExists(db: Db, issueId: string) {
  const issue = await db
    .select({ id: issues.id, companyId: issues.companyId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .then((rows) => rows[0] ?? null);
  if (!issue) throw notFound("Issue not found");
  return issue;
}

export function issueReferenceFileService(db: Db) {
  const documentsSvc = documentService(db);
  const issuesSvc = issueService(db);

  const listManaged = async (issueId: string) => {
    return db
      .select({
        id: issueReferenceFiles.id,
        companyId: issueReferenceFiles.companyId,
        issueId: issueReferenceFiles.issueId,
        kind: issueReferenceFiles.kind,
        name: issueReferenceFiles.name,
        assetId: issueReferenceFiles.assetId,
        repoUrl: issueReferenceFiles.repoUrl,
        repoRef: issueReferenceFiles.repoRef,
        metadata: issueReferenceFiles.metadata,
        createdByAgentId: issueReferenceFiles.createdByAgentId,
        createdByUserId: issueReferenceFiles.createdByUserId,
        createdAt: issueReferenceFiles.createdAt,
        updatedAt: issueReferenceFiles.updatedAt,
        contentType: assets.contentType,
        byteSize: assets.byteSize,
        objectKey: assets.objectKey,
      })
      .from(issueReferenceFiles)
      .leftJoin(assets, eq(issueReferenceFiles.assetId, assets.id))
      .where(eq(issueReferenceFiles.issueId, issueId))
      .orderBy(desc(issueReferenceFiles.createdAt));
  };

  const listForIssue = async (issueId: string): Promise<IssueReferenceFile[]> => {
    const [documents, attachments, managed] = await Promise.all([
      documentsSvc.listIssueDocuments(issueId),
      issuesSvc.listAttachments(issueId),
      listManaged(issueId),
    ]);

    return [
      ...documents.map((document) => ({
        id: document.id,
        companyId: document.companyId,
        issueId: document.issueId,
        kind: "document" as const,
        name: document.title ?? document.key,
        contentType: "text/markdown",
        byteSize: Buffer.byteLength(document.body ?? "", "utf8"),
        attachmentId: null,
        assetId: null,
        documentKey: document.key,
        repoUrl: null,
        repoRef: null,
        metadata: null,
        createdByAgentId: document.createdByAgentId,
        createdByUserId: document.createdByUserId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        materializedPath: null,
      })),
      ...attachments.map((attachment) => ({
        id: attachment.id,
        companyId: attachment.companyId,
        issueId: attachment.issueId,
        kind: "attachment_file" as const,
        name: attachment.originalFilename ?? attachment.id,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        attachmentId: attachment.id,
        assetId: attachment.assetId,
        documentKey: null,
        repoUrl: null,
        repoRef: null,
        metadata: null,
        createdByAgentId: attachment.createdByAgentId,
        createdByUserId: attachment.createdByUserId,
        createdAt: attachment.createdAt,
        updatedAt: attachment.updatedAt,
        materializedPath: null,
      })),
      ...managed.map((entry) => {
        const kind: IssueReferenceFile["kind"] = entry.kind === "folder_archive" ? "folder_archive" : "repo_link";
        return {
          id: entry.id,
          companyId: entry.companyId,
          issueId: entry.issueId,
          kind,
          name: entry.name,
          contentType: entry.contentType ?? null,
          byteSize: entry.byteSize ?? null,
          attachmentId: null,
          assetId: entry.assetId ?? null,
          documentKey: null,
          repoUrl: entry.repoUrl ?? null,
          repoRef: entry.repoRef ?? null,
          metadata: entry.metadata ?? null,
          createdByAgentId: entry.createdByAgentId,
          createdByUserId: entry.createdByUserId,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          materializedPath: null,
        };
      }),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  };

  return {
    listManaged,
    listForIssue,

    getManagedById: async (referenceId: string) => {
      return db
        .select({
          id: issueReferenceFiles.id,
          companyId: issueReferenceFiles.companyId,
          issueId: issueReferenceFiles.issueId,
          kind: issueReferenceFiles.kind,
          name: issueReferenceFiles.name,
          assetId: issueReferenceFiles.assetId,
          repoUrl: issueReferenceFiles.repoUrl,
          repoRef: issueReferenceFiles.repoRef,
          metadata: issueReferenceFiles.metadata,
          createdByAgentId: issueReferenceFiles.createdByAgentId,
          createdByUserId: issueReferenceFiles.createdByUserId,
          createdAt: issueReferenceFiles.createdAt,
          updatedAt: issueReferenceFiles.updatedAt,
          contentType: assets.contentType,
          byteSize: assets.byteSize,
          objectKey: assets.objectKey,
        })
        .from(issueReferenceFiles)
        .leftJoin(assets, eq(issueReferenceFiles.assetId, assets.id))
        .where(eq(issueReferenceFiles.id, referenceId))
        .then((rows) => rows[0] ?? null);
    },

    createFolderArchive: async (input: {
      companyId: string;
      issueId: string;
      name: string;
      provider: string;
      objectKey: string;
      contentType: string;
      byteSize: number;
      sha256: string;
      originalFilename?: string | null;
      metadata?: Record<string, unknown> | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const issue = await ensureIssueExists(db, input.issueId);
      if (issue.companyId !== input.companyId) {
        throw unprocessable("Issue does not belong to company");
      }
      return db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(assets)
          .values({
            companyId: issue.companyId,
            provider: input.provider,
            objectKey: input.objectKey,
            contentType: input.contentType,
            byteSize: input.byteSize,
            sha256: input.sha256,
            originalFilename: input.originalFilename ?? null,
            createdByAgentId: input.createdByAgentId ?? null,
            createdByUserId: input.createdByUserId ?? null,
          })
          .returning();

        const [reference] = await tx
          .insert(issueReferenceFiles)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            kind: "folder_archive",
            name: input.name,
            assetId: asset.id,
            metadata: input.metadata ?? {},
            createdByAgentId: input.createdByAgentId ?? null,
            createdByUserId: input.createdByUserId ?? null,
          })
          .returning();

        logger.info(
          {
            companyId: issue.companyId,
            issueId: issue.id,
            referenceFileId: reference.id,
            assetId: asset.id,
            kind: "folder_archive",
            name: input.name,
            objectKey: input.objectKey,
            byteSize: input.byteSize,
          },
          "created issue reference file",
        );

        return { ...reference, assetId: asset.id };
      });
    },

    createRepoLink: async (input: {
      companyId: string;
      issueId: string;
      name: string;
      repoUrl: string;
      repoRef?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const issue = await ensureIssueExists(db, input.issueId);
      if (issue.companyId !== input.companyId) {
        throw unprocessable("Issue does not belong to company");
      }
      const [reference] = await db
        .insert(issueReferenceFiles)
        .values({
          companyId: issue.companyId,
          issueId: issue.id,
          kind: "repo_link",
          name: input.name,
          repoUrl: input.repoUrl,
          repoRef: input.repoRef ?? null,
          metadata: {},
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      logger.info(
        {
          companyId: issue.companyId,
          issueId: issue.id,
          referenceFileId: reference.id,
          kind: "repo_link",
          name: input.name,
          repoUrl: input.repoUrl,
          repoRef: input.repoRef ?? null,
        },
        "created issue reference file",
      );
      return reference;
    },

    removeManaged: async (referenceId: string) => {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: issueReferenceFiles.id,
            companyId: issueReferenceFiles.companyId,
            issueId: issueReferenceFiles.issueId,
            kind: issueReferenceFiles.kind,
            name: issueReferenceFiles.name,
            assetId: issueReferenceFiles.assetId,
            repoUrl: issueReferenceFiles.repoUrl,
            repoRef: issueReferenceFiles.repoRef,
            metadata: issueReferenceFiles.metadata,
            createdByAgentId: issueReferenceFiles.createdByAgentId,
            createdByUserId: issueReferenceFiles.createdByUserId,
            createdAt: issueReferenceFiles.createdAt,
            updatedAt: issueReferenceFiles.updatedAt,
            objectKey: assets.objectKey,
          })
          .from(issueReferenceFiles)
          .leftJoin(assets, eq(issueReferenceFiles.assetId, assets.id))
          .where(eq(issueReferenceFiles.id, referenceId))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        await tx.delete(issueReferenceFiles).where(eq(issueReferenceFiles.id, referenceId));
        if (existing.assetId) {
          await tx.delete(assets).where(eq(assets.id, existing.assetId));
        }
        return existing;
      });
    },

    materializeForIssue: async (input: {
      companyId: string;
      issueId: string;
      rootDir: string;
      storage: StorageService;
    }) => {
      const references = await listForIssue(input.issueId);
      const counts = references.reduce<Record<string, number>>((acc, reference) => {
        acc[reference.kind] = (acc[reference.kind] ?? 0) + 1;
        return acc;
      }, {});
      logger.info(
        {
          companyId: input.companyId,
          issueId: input.issueId,
          rootDir: input.rootDir,
          referenceCount: references.length,
          counts,
        },
        "starting issue reference file materialization",
      );
      await fs.rm(input.rootDir, { recursive: true, force: true });

      if (references.length === 0) {
        logger.info(
          {
            companyId: input.companyId,
            issueId: input.issueId,
            rootDir: input.rootDir,
          },
          "no issue reference files to materialize",
        );
        return { rootDir: input.rootDir, references: [] as IssueReferenceFile[] };
      }

      const documents = await documentsSvc.listIssueDocuments(input.issueId);
      const documentsById = new Map(documents.map((entry) => [entry.id, entry]));
      const attachments = await issuesSvc.listAttachments(input.issueId);
      const attachmentsById = new Map(attachments.map((entry) => [entry.id, entry]));
      const managedById = new Map((await listManaged(input.issueId)).map((entry) => [entry.id, entry]));

      await fs.mkdir(input.rootDir, { recursive: true });
      const materialized: IssueReferenceFile[] = [];

      for (const reference of references) {
        if (reference.kind === "document") {
          const document = documentsById.get(reference.id);
          if (!document) continue;
          const filePath = path.join(input.rootDir, inferDocumentFilename({ key: document.key, title: document.title }));
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, document.body ?? "", "utf8");
          logger.info(
            {
              companyId: input.companyId,
              issueId: input.issueId,
              referenceFileId: reference.id,
              kind: reference.kind,
              materializedPath: filePath,
            },
            "materialized issue reference file",
          );
          materialized.push({ ...reference, materializedPath: filePath });
          continue;
        }

        if (reference.kind === "attachment_file" && reference.attachmentId) {
          const attachment = attachmentsById.get(reference.attachmentId);
          if (!attachment) continue;
          const filePath = path.join(
            input.rootDir,
            safePathSegment(attachment.originalFilename ?? reference.name, reference.id),
          );
          const object = await input.storage.getObject(attachment.companyId, attachment.objectKey);
          const body = await readStreamBuffer(object.stream);
          await fs.writeFile(filePath, body);
          logger.info(
            {
              companyId: input.companyId,
              issueId: input.issueId,
              referenceFileId: reference.id,
              kind: reference.kind,
              materializedPath: filePath,
              sourceObjectKey: attachment.objectKey,
            },
            "materialized issue reference file",
          );
          materialized.push({ ...reference, materializedPath: filePath });
          continue;
        }

        if (reference.kind === "folder_archive") {
          const managed = managedById.get(reference.id);
          if (!managed?.assetId || !managed.objectKey) continue;
          const object = await input.storage.getObject(input.companyId, managed.objectKey);
          const archive = await readStreamBuffer(object.stream);
          const archiveContents = await readStoredZipArchive(new Uint8Array(archive));
          const folderDir = path.join(input.rootDir, safePathSegment(reference.name, reference.id));
          await fs.mkdir(folderDir, { recursive: true });
          for (const file of archiveContents.files) {
            const relativePath = normalizeArchivePath(file.relativePath);
            if (!relativePath) continue;
            const filePath = path.join(folderDir, relativePath);
            if (!filePath.startsWith(folderDir)) {
              throw conflict("Folder archive contained an unsafe path");
            }
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file.bytes);
          }
          logger.info(
            {
              companyId: input.companyId,
              issueId: input.issueId,
              referenceFileId: reference.id,
              kind: reference.kind,
              materializedPath: folderDir,
              extractedFileCount: archiveContents.files.length,
              sourceObjectKey: managed.objectKey,
            },
            "materialized issue reference file",
          );
          materialized.push({ ...reference, materializedPath: folderDir });
          continue;
        }

        if (reference.kind === "repo_link" && reference.repoUrl) {
          const repoDir = path.join(input.rootDir, safePathSegment(reference.name, reference.id));
          await execFileAsync("git", ["clone", reference.repoUrl, repoDir]);
          if (reference.repoRef) {
            await execFileAsync("git", ["-C", repoDir, "checkout", reference.repoRef]);
          }
          logger.info(
            {
              companyId: input.companyId,
              issueId: input.issueId,
              referenceFileId: reference.id,
              kind: reference.kind,
              materializedPath: repoDir,
              repoUrl: reference.repoUrl,
              repoRef: reference.repoRef ?? null,
            },
            "materialized issue reference file",
          );
          materialized.push({ ...reference, materializedPath: repoDir });
        }
      }

      logger.info(
        {
          companyId: input.companyId,
          issueId: input.issueId,
          rootDir: input.rootDir,
          materializedCount: materialized.length,
        },
        "finished issue reference file materialization",
      );
      return { rootDir: input.rootDir, references: materialized };
    },
  };
}
