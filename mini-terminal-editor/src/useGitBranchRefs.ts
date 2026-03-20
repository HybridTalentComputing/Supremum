import { useCallback, useEffect, useState } from "react";
import { gitCheckoutRef, gitListRefs } from "./gitApi";
import type { GitRefKind, GitRefList } from "./gitTypes";

type UseGitBranchRefsOptions = {
  workspacePath: string | null;
  active?: boolean;
  enabled?: boolean;
  refreshToken?: number;
  onAfterCheckout?: () => Promise<unknown> | void;
};

type GitBranchRefsAction = "checkout" | "refresh" | null;

export function useGitBranchRefs({
  workspacePath,
  active = false,
  enabled = true,
  refreshToken = 0,
  onAfterCheckout,
}: UseGitBranchRefsOptions) {
  const [branchRefs, setBranchRefs] = useState<GitRefList | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GitBranchRefsAction>(null);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!workspacePath || !enabled) {
        setBranchRefs(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
        setPendingAction("refresh");
      }

      try {
        const nextRefs = await gitListRefs(workspacePath);
        setBranchRefs(nextRefs);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        if (!silent) {
          setIsLoading(false);
          setPendingAction(null);
        }
      }
    },
    [enabled, workspacePath],
  );

  const checkoutRef = useCallback(
    async (name: string, kind: GitRefKind) => {
      if (!workspacePath || !enabled) return;

      setPendingAction("checkout");
      setError(null);

      try {
        await gitCheckoutRef(workspacePath, name, kind);
        await Promise.resolve(onAfterCheckout?.());
        await refresh({ silent: true });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setPendingAction(null);
      }
    },
    [enabled, onAfterCheckout, refresh, workspacePath],
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    if (!workspacePath || !active || !enabled) return;

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, enabled, refresh, workspacePath]);

  return {
    branchRefs,
    isLoading,
    error,
    pendingAction,
    refresh,
    checkoutRef,
  };
}
