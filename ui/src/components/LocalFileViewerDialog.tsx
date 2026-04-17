import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatByteSize(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[idx]}`;
}

export function LocalFileViewerDialog({
  issueId,
  filePath,
  open,
  onOpenChange,
  onOpenLocalFile,
}: {
  issueId: string | null | undefined;
  filePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenLocalFile?: (filePath: string) => void;
}) {
  const metadataQuery = useQuery({
    queryKey: issueId && filePath ? queryKeys.issues.localFileMeta(issueId, filePath) : ["issues", "local-file-meta", "__disabled__"],
    queryFn: () => issuesApi.getLocalFileMeta(issueId!, filePath!),
    enabled: open && Boolean(issueId && filePath),
  });

  const textQuery = useQuery({
    queryKey:
      issueId && filePath
        ? queryKeys.issues.localFileText(issueId, filePath)
        : ["issues", "local-file-text", "__disabled__"],
    enabled:
      open &&
      Boolean(issueId && filePath) &&
      (metadataQuery.data?.kind === "markdown" || metadataQuery.data?.kind === "text"),
    queryFn: async () => {
      const response = await fetch(metadataQuery.data!.contentPath, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to load file content: ${response.status}`);
      }
      return response.text();
    },
  });

  const metadata = metadataQuery.data;
  const title = metadata?.name ?? filePath?.split("/").filter(Boolean).pop() ?? "Local file";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden p-4 sm:w-[min(96vw,72rem)] sm:max-w-[min(96vw,72rem)] sm:p-6 xl:w-[min(94vw,84rem)] xl:max-w-[min(94vw,84rem)]">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription className="min-w-0 space-y-1 text-xs">
            {metadata ? (
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{metadata.contentType}</span>
                  <span>{formatByteSize(metadata.byteSize)}</span>
                </div>
                <div className="break-all text-[11px] leading-relaxed text-muted-foreground/90">{metadata.path}</div>
              </div>
            ) : filePath ? (
              <div className="break-all text-[11px] leading-relaxed text-muted-foreground/90">{filePath}</div>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {metadataQuery.isLoading ? (
          <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
            Loading file metadata...
          </div>
        ) : metadataQuery.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {metadataQuery.error instanceof Error ? metadataQuery.error.message : "Failed to load file metadata."}
          </div>
        ) : metadata ? (
          <div className="space-y-3">
            {(metadata.kind === "markdown" || metadata.kind === "text") && textQuery.isLoading ? (
              <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
                Loading file content...
              </div>
            ) : null}

            {(metadata.kind === "markdown" || metadata.kind === "text") && textQuery.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {textQuery.error instanceof Error ? textQuery.error.message : "Failed to load file content."}
              </div>
            ) : null}

            {metadata.kind === "markdown" && typeof textQuery.data === "string" ? (
              <div className="max-h-[70vh] overflow-auto rounded-md border border-border/60 p-4">
                <MarkdownBody
                  softBreaks={false}
                  onOpenLocalFile={onOpenLocalFile}
                >
                  {textQuery.data}
                </MarkdownBody>
              </div>
            ) : null}

            {metadata.kind === "text" && typeof textQuery.data === "string" ? (
              <pre className="max-h-[70vh] overflow-auto rounded-md border border-border/60 bg-muted/20 p-4 text-xs leading-5 whitespace-pre-wrap break-words">
                {textQuery.data}
              </pre>
            ) : null}

            {metadata.kind === "image" ? (
              <div className="max-h-[70vh] overflow-auto rounded-md border border-border/60 bg-muted/10 p-3">
                <img src={metadata.contentPath} alt={metadata.name} className="mx-auto max-h-[64vh] max-w-full object-contain" />
              </div>
            ) : null}

            {metadata.kind === "pdf" ? (
              <div className="h-[70vh] overflow-hidden rounded-md border border-border/60">
                <iframe title={metadata.name} src={metadata.contentPath} className="h-full w-full" />
              </div>
            ) : null}

            {metadata.kind === "binary" ? (
              <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                Preview is not available for this file type.
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href={metadata.contentPath} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open file
                </a>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
