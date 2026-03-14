/**
 * File icon mapping based on material-icon-theme
 * Provides JetBrains-style file icons with support for file names, extensions, and folders
 */

import { useEffect, useState } from "react";

interface FileIconManifest {
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  defaultIcon: string;
  defaultFolderIcon: string;
  defaultFolderOpenIcon: string;
}

// Cache the manifest after first load
let manifestCache: FileIconManifest | null = null;
let manifestLoadPromise: Promise<FileIconManifest> | null = null;

async function loadManifest(): Promise<FileIconManifest> {
  if (manifestCache) return manifestCache;
  if (manifestLoadPromise) return manifestLoadPromise;

  manifestLoadPromise = (async () => {
    const response = await fetch("/file-icons/manifest.json");
    if (!response.ok) {
      throw new Error(`Failed to load file icons manifest: ${response.statusText}`);
    }
    const manifest = await response.json();
    manifestCache = manifest;
    return manifest;
  })();

  return manifestLoadPromise;
}

/**
 * Get the icon name for a file or folder
 * @param fileName - File or folder name
 * @param isDirectory - Whether this is a directory
 * @param isOpen - Whether the folder is open (only applies to directories)
 * @returns Icon name (without .svg extension)
 */
async function getFileIconName(
  fileName: string,
  isDirectory: boolean,
  isOpen = false,
): Promise<string> {
  const manifest = await loadManifest();

  if (isDirectory) {
    const baseName = fileName.toLowerCase();
    // Check for folder-specific icon
    if (manifest.folderNames[baseName]) {
      const iconName = isOpen
        ? (manifest.folderNamesExpanded[baseName] ??
            manifest.folderNames[baseName])
        : manifest.folderNames[baseName];
      return iconName;
    }
    // Use default folder icon
    return isOpen ? manifest.defaultFolderOpenIcon : manifest.defaultFolderIcon;
  }

  // Check exact filename match (case-sensitive first, then lowercase)
  if (manifest.fileNames[fileName]) {
    return manifest.fileNames[fileName];
  }
  const fileNameLower = fileName.toLowerCase();
  if (manifest.fileNames[fileNameLower]) {
    return manifest.fileNames[fileNameLower];
  }

  // Check file extensions (try compound extensions first, e.g. "d.ts" before "ts")
  const dotIndex = fileName.indexOf(".");
  if (dotIndex !== -1) {
    const afterFirstDot = fileName.slice(dotIndex + 1).toLowerCase();
    const segments = afterFirstDot.split(".");
    for (let i = 0; i < segments.length; i++) {
      const ext = segments.slice(i).join(".");
      if (manifest.fileExtensions[ext]) {
        return manifest.fileExtensions[ext];
      }
    }
  }

  // Use default file icon
  return manifest.defaultIcon;
}

/**
 * React hook to get the icon URL for a file or folder
 * @param fileName - File or folder name
 * @param isDirectory - Whether this is a directory
 * @param isOpen - Whether the folder is open (only applies to directories)
 * @returns Icon URL or null while loading
 */
export function useFileIconUrl(
  fileName: string,
  isDirectory: boolean = false,
  isOpen: boolean = false,
): string | null {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFileIconName(fileName, isDirectory, isOpen).then((iconName) => {
      if (!cancelled) {
        setIconUrl(`/file-icons/${iconName}.svg`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fileName, isDirectory, isOpen]);

  return iconUrl;
}

/**
 * Get the icon URL for a file or folder (async version)
 * @param fileName - File or folder name
 * @param isDirectory - Whether this is a directory
 * @param isOpen - Whether the folder is open (only applies to directories)
 * @returns Full URL to the icon SVG
 */
export async function getFileIconUrl(
  fileName: string,
  isDirectory?: boolean,
  isOpen?: boolean,
): Promise<string> {
  const iconName = await getFileIconName(fileName, isDirectory ?? false, isOpen);
  return `/file-icons/${iconName}.svg`;
}
