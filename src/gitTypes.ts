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
export type GitBranchKind = "local" | "remote" | "tag";
export type GitRefKind = "local" | "remote" | "tag";

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

export type GitBranchList = {
  current: string;
  local: string[];
  remote: string[];
  tags: string[];
};

export type GitRefList = {
  current: string;
  local: string[];
  remote: string[];
  tags: string[];
};

export type GitGraphCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorRelativeTime: string;
  parents: string[];
  refs: string[];
  isHead: boolean;
};

export type GitGraphResponse = {
  commits: GitGraphCommit[];
};
