export type PreviewKind = "markdown" | "image";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);
const IMAGE_EXTENSIONS = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
]);
const IMAGE_CODE_VIEWABLE_EXTENSIONS = new Set(["svg"]);

export function getFileExtensionForPreview(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function getPreviewKind(path: string): PreviewKind | null {
  const ext = getFileExtensionForPreview(path);

  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

export function isPreviewablePath(path: string) {
  return getPreviewKind(path) !== null;
}

export function supportsCodeViewForPath(path: string) {
  const previewKind = getPreviewKind(path);

  if (previewKind === "markdown") return true;
  if (previewKind === "image") {
    return IMAGE_CODE_VIEWABLE_EXTENSIONS.has(getFileExtensionForPreview(path));
  }

  return false;
}

export function shouldReadFileContentForOpen(path: string) {
  const previewKind = getPreviewKind(path);

  if (previewKind === null) return true;
  if (previewKind === "image") return supportsCodeViewForPath(path);
  return true;
}
