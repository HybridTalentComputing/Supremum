import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  gitCommit,
  gitDiscardAll,
  gitDiscardFile,
  gitGetCapability,
  gitGetStatus,
  gitInitRepository,
  gitStageAll,
  gitStageFile,
  gitUnstageAll,
  gitUnstageFile,
} from "./gitApi";
import type { GitCapabilityResponse, GitChangesStatus } from "./gitTypes";

type GitAction =
  | "refresh"
  | "init"
  | "stage-file"
  | "unstage-file"
  | "stage-all"
  | "unstage-all"
  | "discard-file"
  | "discard-all"
  | "commit"
  | null;

type UseGitChangesOptions = {
  workspacePath: string | null;
  active?: boolean;
};

type GitMutationResult<T = void> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type RefreshOptions = {
  silent?: boolean;
};

export function useGitChanges({ workspacePath, active = false }: UseGitChangesOptions) {
  const [capability, setCapability] = useState<GitCapabilityResponse | null>(null);
  const [status, setStatus] = useState<GitChangesStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GitAction>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshIdRef = useRef(0);

  const refresh = useCallback(async ({ silent = false }: RefreshOptions = {}) => {
    if (!workspacePath) {
      setCapability(null);
      setStatus(null);
      setError(null);
      return;
    }

    const refreshId = refreshIdRef.current + 1;
    refreshIdRef.current = refreshId;
    if (!silent) {
      setIsLoading(true);
      setPendingAction("refresh");
    }

    try {
      const nextCapability = await gitGetCapability(workspacePath);
      if (refreshId !== refreshIdRef.current) return;
      setCapability(nextCapability);

      if (nextCapability.status !== "available") {
        setStatus(null);
        setError(nextCapability.status === "git_error" ? nextCapability.message ?? "Git failed." : null);
        setRefreshToken((value) => value + 1);
        return;
      }

      const nextStatus = await gitGetStatus(workspacePath);
      if (refreshId !== refreshIdRef.current) return;
      setStatus(nextStatus);
      setError(null);
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      if (refreshId !== refreshIdRef.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (refreshId === refreshIdRef.current) {
        if (!silent) {
          setIsLoading(false);
          setPendingAction(null);
        }
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspacePath || !active || capability?.status !== "available") return;

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, capability?.status, refresh, workspacePath]);

  const runMutation = useCallback(
    async <T,>(
      action: GitAction,
      operation: () => Promise<T>,
    ): Promise<GitMutationResult<T>> => {
      if (!workspacePath) {
        return { ok: false, error: "No workspace selected." };
      }

      setPendingAction(action);
      setError(null);

      try {
        const data = await operation();
        await refresh({ silent: true });
        return { ok: true, data };
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setPendingAction(null);
      }
    },
    [refresh, workspacePath],
  );

  const combinedChanges = useMemo(
    () => [...(status?.unstaged ?? []), ...(status?.untracked ?? [])],
    [status?.unstaged, status?.untracked],
  );

  return {
    capability,
    status,
    combinedChanges,
    isLoading,
    error,
    pendingAction,
    refreshToken,
    refresh,
    initRepository: () => runMutation("init", () => gitInitRepository(workspacePath!)),
    stageFile: (path: string) => runMutation("stage-file", () => gitStageFile(workspacePath!, path)),
    unstageFile: (path: string) =>
      runMutation("unstage-file", () => gitUnstageFile(workspacePath!, path)),
    stageAll: () => runMutation("stage-all", () => gitStageAll(workspacePath!)),
    unstageAll: () => runMutation("unstage-all", () => gitUnstageAll(workspacePath!)),
    discardFile: (path: string) =>
      runMutation("discard-file", () => gitDiscardFile(workspacePath!, path)),
    discardAll: () => runMutation("discard-all", () => gitDiscardAll(workspacePath!)),
    commit: (message: string) => runMutation("commit", () => gitCommit(workspacePath!, message)),
  };
}

export type UseGitChangesResult = ReturnType<typeof useGitChanges>;
