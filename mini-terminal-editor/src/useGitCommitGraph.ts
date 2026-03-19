import { useCallback, useEffect, useRef, useState } from "react";
import { gitGetGraph } from "./gitApi";
import type { GitGraphResponse } from "./gitTypes";

type UseGitCommitGraphOptions = {
  workspacePath: string | null;
  active?: boolean;
  enabled?: boolean;
  refreshToken?: number;
};

export function useGitCommitGraph({
  workspacePath,
  active = false,
  enabled = true,
  refreshToken = 0,
}: UseGitCommitGraphOptions) {
  const [graph, setGraph] = useState<GitGraphResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshIdRef = useRef(0);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!workspacePath || !enabled) {
        setGraph(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      const refreshId = refreshIdRef.current + 1;
      refreshIdRef.current = refreshId;
      if (!silent) {
        setIsLoading(true);
      }

      try {
        const nextGraph = await gitGetGraph(workspacePath);
        if (refreshId !== refreshIdRef.current) return;
        setGraph(nextGraph);
        setError(null);
      } catch (nextError) {
        if (refreshId !== refreshIdRef.current) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        if (refreshId === refreshIdRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [enabled, workspacePath],
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    if (!workspacePath || !active || !enabled) return;

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, enabled, refresh, workspacePath]);

  return {
    graph,
    isLoading,
    error,
    refresh,
  };
}
