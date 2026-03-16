import type { GitChangedFile, GitDiffCategory, GitFileStatus } from "./gitTypes";

export function getDiffFileName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function getDiffFileDirectory(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).join("/");
}

export function getGitStatusCode(status: GitFileStatus) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "modified":
    default:
      return "M";
  }
}

export function isDiffEditable(file: GitChangedFile, category: GitDiffCategory) {
  return category === "unstaged" && file.status !== "deleted";
}

export function getDiffSideLabels(file: GitChangedFile, category: GitDiffCategory) {
  if (category === "staged") {
    return {
      left: "HEAD",
      right: "Index",
      tabSource: "Index",
      categoryLabel: "STAGED",
    };
  }

  if (file.status === "untracked") {
    return {
      left: "Empty",
      right: "Working Tree",
      tabSource: "Working Tree",
      categoryLabel: "UNSTAGED",
    };
  }

  return {
    left: "Index",
    right: "Working Tree",
    tabSource: "Working Tree",
    categoryLabel: "UNSTAGED",
  };
}

export function getDiffTabLabel(file: GitChangedFile, category: GitDiffCategory) {
  const { tabSource } = getDiffSideLabels(file, category);
  return `${getDiffFileName(file.path)} (${tabSource})`;
}
