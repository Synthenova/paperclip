import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  addWorkspaceExplorerRepoSchema,
  createWorkspaceExplorerFileSchema,
  createWorkspaceExplorerFolderSchema,
  renameWorkspaceExplorerEntrySchema,
  updateWorkspaceExplorerFileSchema,
} from "@paperclipai/shared";
import { MAX_ATTACHMENT_BYTES } from "../attachment-types.js";
import { validate } from "../middleware/validate.js";
import { workspaceExplorerService } from "../services/workspace-explorer.js";

type ExplorerRoot = {
  rootDir: string;
  rootName: string;
  ensureExists?: boolean;
};

type ExplorerContext = {
  companyId: string;
  entityType: string;
  entityId: string;
  root: ExplorerRoot;
};

type MutationAction =
  | "listed"
  | "file_created"
  | "file_updated"
  | "folder_created"
  | "file_uploaded"
  | "folder_uploaded"
  | "repo_added"
  | "entry_renamed"
  | "entry_deleted";

export function registerWorkspaceExplorerRoutes(input: {
  router: Router;
  basePath: string;
  resolveContext(req: Request): Promise<ExplorerContext>;
  buildContentPath(req: Request, relativePath: string): string;
  logMutation?(req: Request, context: ExplorerContext, action: MutationAction, details: Record<string, unknown>): Promise<void>;
}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 64 },
  });

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  input.router.get(`${input.basePath}/tree`, async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      const directory = await workspaceExplorerService.listDirectory(context.root, relativePath);
      res.json(directory);
    } catch (error) {
      next(error);
    }
  });

  input.router.get(`${input.basePath}/file`, async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      const meta = await workspaceExplorerService.getFileMeta(
        context.root,
        relativePath,
        input.buildContentPath(req, relativePath),
      );
      res.json(meta);
    } catch (error) {
      next(error);
    }
  });

  input.router.get(`${input.basePath}/content`, async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      const { stream, meta } = await workspaceExplorerService.streamFile(context.root, relativePath);
      res.setHeader("Content-Type", meta.contentType);
      res.setHeader(
        "Content-Disposition",
        meta.inline ? "inline" : `attachment; filename="${encodeURIComponent(meta.name)}"`,
      );
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  input.router.post(`${input.basePath}/file`, validate(createWorkspaceExplorerFileSchema), async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const created = await workspaceExplorerService.createFile(context.root, {
        parentPath: req.body.parentPath,
        name: req.body.name,
        content: req.body.content,
      });
      await input.logMutation?.(req, context, "file_created", {
        path: created.path,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  input.router.put(`${input.basePath}/file`, validate(updateWorkspaceExplorerFileSchema), async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const updated = await workspaceExplorerService.updateFile(context.root, {
        path: req.body.path,
        content: req.body.content,
      });
      await input.logMutation?.(req, context, "file_updated", {
        path: updated.path,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  input.router.post(`${input.basePath}/folder`, validate(createWorkspaceExplorerFolderSchema), async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const created = await workspaceExplorerService.createFolder(context.root, {
        parentPath: req.body.parentPath,
        name: req.body.name,
      });
      await input.logMutation?.(req, context, "folder_created", {
        path: created.path,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  input.router.post(`${input.basePath}/upload-file`, async (req, res, next) => {
    try {
      await runSingleFileUpload(req, res);
      const context = await input.resolveContext(req);
      if (!req.file) {
        res.status(422).json({ error: "File is required" });
        return;
      }
      const parentPath = typeof req.body.parentPath === "string" ? req.body.parentPath : "";
      const uploaded = await workspaceExplorerService.uploadFile(context.root, {
        parentPath,
        fileName: req.file.originalname,
        bytes: req.file.buffer,
      });
      await input.logMutation?.(req, context, "file_uploaded", {
        path: uploaded.path,
        originalName: req.file.originalname,
        byteSize: req.file.size,
      });
      res.status(201).json(uploaded);
    } catch (error) {
      next(error);
    }
  });

  input.router.post(`${input.basePath}/upload-folder`, async (req, res, next) => {
    try {
      await runSingleFileUpload(req, res);
      const context = await input.resolveContext(req);
      if (!req.file) {
        res.status(422).json({ error: "Folder archive is required" });
        return;
      }
      const parentPath = typeof req.body.parentPath === "string" ? req.body.parentPath : "";
      const requestedName = typeof req.body.name === "string" ? req.body.name : "";
      const archiveName = req.file.originalname.replace(/\.zip$/i, "");
      const uploaded = await workspaceExplorerService.uploadFolder(context.root, {
        parentPath,
        folderName: requestedName.trim() || archiveName || "folder",
        archiveBytes: new Uint8Array(req.file.buffer),
      });
      await input.logMutation?.(req, context, "folder_uploaded", {
        path: uploaded.path,
        originalName: req.file.originalname,
        byteSize: req.file.size,
      });
      res.status(201).json(uploaded);
    } catch (error) {
      next(error);
    }
  });

  input.router.post(`${input.basePath}/repo`, validate(addWorkspaceExplorerRepoSchema), async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const created = await workspaceExplorerService.addRepo(context.root, {
        parentPath: req.body.parentPath,
        repoUrl: req.body.repoUrl,
        repoRef: req.body.repoRef,
        name: req.body.name,
      });
      await input.logMutation?.(req, context, "repo_added", {
        path: created.path,
        repoUrl: req.body.repoUrl,
        repoRef: req.body.repoRef ?? null,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  input.router.patch(`${input.basePath}/entry`, validate(renameWorkspaceExplorerEntrySchema), async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const renamed = await workspaceExplorerService.renameEntry(context.root, {
        relativePath: req.body.path,
        newName: req.body.newName,
      });
      await input.logMutation?.(req, context, "entry_renamed", {
        fromPath: req.body.path,
        toPath: renamed.path,
      });
      res.json(renamed);
    } catch (error) {
      next(error);
    }
  });

  input.router.delete(`${input.basePath}/entry`, async (req, res, next) => {
    try {
      const context = await input.resolveContext(req);
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      await workspaceExplorerService.deleteEntry(context.root, relativePath);
      await input.logMutation?.(req, context, "entry_deleted", {
        path: relativePath,
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}
