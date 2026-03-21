import { invoke } from "@tauri-apps/api/core";
import type {
  GitBranchKind,
  GitBranchList,
  GitCapabilityResponse,
  GitChangedFile,
  GitChangesStatus,
  GitCommitResult,
  GitDiffCategory,
  GitDiffContents,
  GitGraphResponse,
  GitRefKind,
  GitRefList,
} from "./gitTypes";

export function gitGetCapability(workspacePath: string): Promise<GitCapabilityResponse> {
  return invoke("git_get_capability", { payload: { workspacePath } });
}

export function gitInitRepository(workspacePath: string): Promise<GitCapabilityResponse> {
  return invoke("git_init_repository", { payload: { workspacePath } });
}

export function gitGetStatus(workspacePath: string): Promise<GitChangesStatus> {
  return invoke("git_get_status", { payload: { workspacePath } });
}

export function gitListBranches(workspacePath: string): Promise<GitBranchList> {
  return invoke("git_list_branches", { payload: { workspacePath } });
}

export function gitListRefs(workspacePath: string): Promise<GitRefList> {
  return invoke("git_list_refs", { payload: { workspacePath } });
}

export function gitGetGraph(workspacePath: string): Promise<GitGraphResponse> {
  return invoke("git_get_graph", { payload: { workspacePath } });
}

export function gitFetchAllRemotes(workspacePath: string): Promise<void> {
  return invoke("git_fetch_all_remotes", { payload: { workspacePath } });
}

export function gitPull(workspacePath: string): Promise<void> {
  return invoke("git_pull", { payload: { workspacePath } });
}

export function gitPush(workspacePath: string): Promise<void> {
  return invoke("git_push", { payload: { workspacePath } });
}

export function gitCheckoutBranch(
  workspacePath: string,
  branch: string,
  kind: GitBranchKind,
): Promise<void> {
  return invoke("git_checkout_branch", { payload: { workspacePath, branch, kind } });
}

export function gitCheckoutRef(
  workspacePath: string,
  reference: string,
  kind: GitRefKind,
): Promise<void> {
  return invoke("git_checkout_ref", { payload: { workspacePath, reference, kind } });
}

export function gitCreateBranch(
  workspacePath: string,
  name: string,
  from?: string | null,
): Promise<void> {
  return invoke("git_create_branch", { payload: { workspacePath, name, from } });
}

export function gitGetDiffContents(
  workspacePath: string,
  file: GitChangedFile,
  category: GitDiffCategory,
): Promise<GitDiffContents> {
  return invoke("git_get_diff_contents", {
    payload: {
      workspacePath,
      path: file.path,
      oldPath: file.oldPath,
      category,
      status: file.status,
    },
  });
}

export function gitStageFile(workspacePath: string, path: string): Promise<void> {
  return invoke("git_stage_file", { payload: { workspacePath, path } });
}

export function gitUnstageFile(workspacePath: string, path: string): Promise<void> {
  return invoke("git_unstage_file", { payload: { workspacePath, path } });
}

export function gitStageAll(workspacePath: string): Promise<void> {
  return invoke("git_stage_all", { payload: { workspacePath } });
}

export function gitUnstageAll(workspacePath: string): Promise<void> {
  return invoke("git_unstage_all", { payload: { workspacePath } });
}

export function gitDiscardFile(workspacePath: string, path: string): Promise<void> {
  return invoke("git_discard_file", { payload: { workspacePath, path } });
}

export function gitDiscardAll(workspacePath: string): Promise<void> {
  return invoke("git_discard_all", { payload: { workspacePath } });
}

export function gitCommit(workspacePath: string, message: string): Promise<GitCommitResult> {
  return invoke("git_commit", { payload: { workspacePath, message } });
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
