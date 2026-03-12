import {
  formatWorkspacePath,
  ports,
  type WorkspaceTask
} from "../../lib/mock-data/workbench";

type WorkspaceSidebarProps = {
  workspaces: WorkspaceTask[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedTaskId: string;
  onAddWorkspace: () => void;
  onSelectTask: (taskId: string) => void;
};

export function WorkspaceSidebar({
  workspaces,
  isLoading,
  errorMessage,
  selectedTaskId,
  onAddWorkspace,
  onSelectTask
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar">
      <div className="window-controls" aria-hidden="true">
        <span className="window-dot window-dot-red" />
        <span className="window-dot window-dot-yellow" />
        <span className="window-dot window-dot-green" />
      </div>

      <button className="sidebar-create-button" type="button" onClick={onAddWorkspace}>
        <span className="sidebar-create-icon">+</span>
        <span>New Workspace</span>
      </button>

      <div className="sidebar-section-header">
        <span>superset</span>
        <span className="sidebar-section-meta">({workspaces.length})</span>
      </div>

      <div className="task-list">
        {isLoading ? (
          <div className="sidebar-status-message">Loading workspaces...</div>
        ) : null}

        {!isLoading && errorMessage ? (
          <div className="sidebar-status-message">{errorMessage}</div>
        ) : null}

        {!isLoading &&
          workspaces.map((task) => {
          const selected = task.id === selectedTaskId;
          return (
            <button
              key={task.id}
              type="button"
              className={`task-item${selected ? " is-selected" : ""}`}
              onClick={() => onSelectTask(task.id)}
            >
              <span className="task-item-bullet" />
              <span className="task-item-body">
                <span className="task-item-name">{task.name}</span>
                <span className="task-item-slug" title={task.path ?? task.slug}>
                  {formatWorkspacePath(task.path ?? task.slug)}
                </span>
              </span>
              <span className="task-item-metrics">
                <span className="task-item-change">{task.change}</span>
                <span className="task-item-count">
                  {task.count > 0 ? `#${task.count}` : task.status}
                </span>
              </span>
            </button>
          );
          })}
      </div>

      <div className="ports-panel">
        <div className="ports-header">
          <span>Ports</span>
          <span className="sidebar-section-meta">4</span>
        </div>

        <div className="ports-list">
          {ports.map((entry) => (
            <div key={entry.id} className="port-card">
              <div className="port-title-row">
                <span className="port-title">{entry.label}</span>
                <button className="port-close" type="button">
                  ×
                </button>
              </div>
              <div className="port-badges">
                {entry.ports.map((port) => (
                  <span key={port} className="port-badge">
                    {port}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
