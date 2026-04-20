import { createZipArchive } from "./zip";

function fileBaseName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function buildFolderArchiveFile(files: FileList) {
  const selectedFiles = Array.from(files).filter((file) => (file.webkitRelativePath || file.name).length > 0);
  if (selectedFiles.length === 0) {
    throw new Error("No folder files were selected.");
  }
  const firstRelativePath = selectedFiles[0]!.webkitRelativePath || selectedFiles[0]!.name;
  const rootName = firstRelativePath.split("/").filter(Boolean)[0] ?? (fileBaseName(selectedFiles[0]!.name) || "folder");
  const archiveEntries: Record<string, { encoding: "base64"; data: string; contentType: string }> = {};
  for (const file of selectedFiles) {
    const relativePath = file.webkitRelativePath || file.name;
    const pathParts = relativePath.split("/").filter(Boolean);
    const archivePath = pathParts.length > 1 ? pathParts.slice(1).join("/") : pathParts[0]!;
    const bytes = new Uint8Array(await file.arrayBuffer());
    archiveEntries[archivePath] = {
      encoding: "base64",
      data: bytesToBase64(bytes),
      contentType: file.type || "application/octet-stream",
    };
  }
  const archiveBytes = createZipArchive(archiveEntries, rootName);
  const archiveBuffer = new ArrayBuffer(archiveBytes.byteLength);
  new Uint8Array(archiveBuffer).set(archiveBytes);
  return {
    name: rootName,
    file: new File([archiveBuffer], `${rootName}.zip`, { type: "application/zip" }),
  };
}
