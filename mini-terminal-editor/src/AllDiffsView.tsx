import { GitCompareArrows } from "lucide-react";
import type { GitChangedFile } from "./gitTypes";
import { DiffEditor } from "./DiffEditor";

type AllDiffsViewProps = {
  workspacePath: string;
  stagedFiles: GitChangedFile[];
  unstagedFiles: GitChangedFile[];
  refreshToken: number;
};

function DiffGroup({
  title,
  files,
  workspacePath,
  refreshToken,
  category,
}: {
  title: string;
  files: GitChangedFile[];
  workspacePath: string;
  refreshToken: number;
  category: "staged" | "unstaged";
}) {
  if (files.length === 0) return null;

  return (
    <section className="all-diffs-group">
      <div className="all-diffs-group-header">
        <span>{title}</span>
        <span>{files.length}</span>
      </div>
      <div className="all-diffs-group-body">
        {files.map((file) => (
          <div key={`${category}:${file.path}`} className="all-diffs-item">
            <DiffEditor
              workspacePath={workspacePath}
              file={file}
              category={category}
              refreshToken={refreshToken}
              embedded
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AllDiffsView({
  workspacePath,
  stagedFiles,
  unstagedFiles,
  refreshToken,
}: AllDiffsViewProps) {
  if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
    return (
      <div className="all-diffs-empty">
        <GitCompareArrows className="size-6" />
        <p>No changes to compare.</p>
      </div>
    );
  }

  return (
    <div className="all-diffs-view">
      <DiffGroup
        title="Changes"
        files={unstagedFiles}
        workspacePath={workspacePath}
        refreshToken={refreshToken}
        category="unstaged"
      />
      <DiffGroup
        title="Staged Changes"
        files={stagedFiles}
        workspacePath={workspacePath}
        refreshToken={refreshToken}
        category="staged"
      />
    </div>
  );
}
