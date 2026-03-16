export type GitCapabilityStatus =
  | "available"
  | "missing_git"
  | "not_repository"
  | "unsafe_repository"
  | "git_error";

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

export type GitDiffCategory = "staged" | "unstaged";

export type GitChangedFile = {
  path: string;
  oldPath?: string | null;
  status: GitFileStatus;
  additions: number;
  deletions: number;
};

export type GitCapabilityResponse = {
  status: GitCapabilityStatus;
  message?: string | null;
};

export type GitChangesStatus = {
  branch: string;
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
  untracked: GitChangedFile[];
  hasChanges: boolean;
};

export type GitDiffContents = {
  original: string;
  modified: string;
  language: string;
  isBinary: boolean;
  isTooLarge: boolean;
};

export type GitCommitResult = {
  hash: string;
  summary: string;
};
