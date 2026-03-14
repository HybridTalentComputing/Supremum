export type FileNode = {
  /** Relative path from workspace root, used as unique ID */
  id: string;
  name: string;
  isDir: boolean;
  /** undefined = file (leaf), null = directory (not loaded), FileNode[] = directory (loaded) */
  children?: FileNode[] | null;
};

// Re-export for compatibility
export { useFileIconUrl as getFileIconUrl } from "./fileIcons";
