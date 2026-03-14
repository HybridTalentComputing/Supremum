import {
  FileCode,
  FileText,
  FileJson,
  Terminal,
  Image,
  FileType,
  Cog,
  type LucideIcon,
} from "lucide-react";

export type FileNode = {
  /** Relative path from workspace root, used as unique ID */
  id: string;
  name: string;
  isDir: boolean;
  /** undefined = file (leaf), null = directory (not loaded), FileNode[] = directory (loaded) */
  children?: FileNode[] | null;
};

type FileIconInfo = { Icon: LucideIcon; color: string };

const extMap: Record<string, FileIconInfo> = {
  ts: { Icon: FileCode, color: "#3178c6" },
  tsx: { Icon: FileCode, color: "#3178c6" },
  js: { Icon: FileCode, color: "#f0db4f" },
  jsx: { Icon: FileCode, color: "#f0db4f" },
  mjs: { Icon: FileCode, color: "#f0db4f" },
  cjs: { Icon: FileCode, color: "#f0db4f" },
  rs: { Icon: FileCode, color: "#dea584" },
  json: { Icon: FileJson, color: "#cbcb41" },
  html: { Icon: FileCode, color: "#e34c26" },
  css: { Icon: FileCode, color: "#563d7c" },
  scss: { Icon: FileCode, color: "#c6538c" },
  py: { Icon: FileCode, color: "#3572A5" },
  md: { Icon: FileText, color: "#519aba" },
  mdx: { Icon: FileText, color: "#519aba" },
  sh: { Icon: Terminal, color: "#89e051" },
  bash: { Icon: Terminal, color: "#89e051" },
  zsh: { Icon: Terminal, color: "#89e051" },
  png: { Icon: Image, color: "#a074c4" },
  jpg: { Icon: Image, color: "#a074c4" },
  jpeg: { Icon: Image, color: "#a074c4" },
  gif: { Icon: Image, color: "#a074c4" },
  svg: { Icon: Image, color: "#ffb13b" },
  webp: { Icon: Image, color: "#a074c4" },
  ico: { Icon: Image, color: "#a074c4" },
  toml: { Icon: Cog, color: "#9c4221" },
  yaml: { Icon: Cog, color: "#cb171e" },
  yml: { Icon: Cog, color: "#cb171e" },
  lock: { Icon: FileType, color: "#6b7280" },
  txt: { Icon: FileText, color: "#6b7280" },
};

const nameMap: Record<string, FileIconInfo> = {
  "Cargo.toml": { Icon: Cog, color: "#dea584" },
  "package.json": { Icon: FileJson, color: "#cbcb41" },
  "tsconfig.json": { Icon: Cog, color: "#3178c6" },
  ".gitignore": { Icon: Cog, color: "#f05032" },
  Dockerfile: { Icon: Cog, color: "#384d54" },
};

const defaultIcon: FileIconInfo = { Icon: FileText, color: "#50a4ff" };

export function getFileIcon(filename: string): FileIconInfo {
  if (nameMap[filename]) return nameMap[filename];
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && extMap[ext]) return extMap[ext];
  return defaultIcon;
}
