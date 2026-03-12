type WorkspacePane = "terminal" | "editor" | "diff";

type TopTabsBarProps = {
  activePane: WorkspacePane;
  editorLabel: string;
  diffLabel: string;
  editorDirty: boolean;
  onSelectPane: (pane: WorkspacePane) => void;
};

export function TopTabsBar({
  activePane,
  editorLabel,
  diffLabel,
  editorDirty,
  onSelectPane
}: TopTabsBarProps) {
  const tabs = [
    { id: "terminal" as const, label: "terminal", icon: "•", meta: "session" },
    { id: "editor" as const, label: "editor", icon: "◧", meta: editorLabel },
    { id: "diff" as const, label: "diff", icon: "≋", meta: diffLabel }
  ];

  return (
    <header className="top-tabs">
      <div className="brand-strip" data-tauri-drag-region>
        superset
      </div>
      <div className="tabs-row">
        <div className="tabs-list">
          {tabs.map((tab) => {
            const active = tab.id === activePane;
            return (
              <button
                key={tab.id}
                type="button"
                className={`tab-item${active ? " is-active" : ""}`}
                onClick={() => onSelectPane(tab.id)}
              >
                <span className="tab-item-icon">{tab.icon}</span>
                <span className="tab-item-copy">
                  <span className="tab-item-label">{tab.label}</span>
                  <span className="tab-item-meta">{tab.meta}</span>
                </span>
                {tab.id === "editor" && editorDirty ? <span className="tab-item-dirty">●</span> : null}
              </button>
            );
          })}
        </div>
        <div className="tabs-actions">
          <div className="tabs-drag-strip" data-tauri-drag-region />
          <button type="button" className="tabs-icon-button">
            +
          </button>
          <button type="button" className="tabs-icon-button">
            ˅
          </button>
        </div>
      </div>
    </header>
  );
}
