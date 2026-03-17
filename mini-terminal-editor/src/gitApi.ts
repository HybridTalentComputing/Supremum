import { invoke } from "@tauri-apps/api/core";
import type {
  GitCapabilityResponse,
  GitChangedFile,
  GitChangesStatus,
  GitCommitResult,
  GitDiffCategory,
  GitDiffContents,
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
