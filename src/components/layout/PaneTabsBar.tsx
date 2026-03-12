import type { ReactNode } from "react";

type PaneTab = {
  id: string;
  label: string;
  icon: string;
  dirty?: boolean;
  closable?: boolean;
  placeholder?: boolean;
};

type PaneTabsBarProps = {
  title: string;
  tabs: PaneTab[];
  activeTabId: string | null;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  rightSlot?: ReactNode;
};

export function PaneTabsBar({
  title,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  rightSlot
}: PaneTabsBarProps) {
  return (
    <div className="pane-tabs-bar">
      <div className="pane-tabs-list">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              className={`pane-tab-item${active ? " is-active" : ""}${tab.placeholder ? " is-placeholder" : ""}`}
              onClick={() => onSelectTab?.(tab.id)}
              disabled={tab.placeholder}
            >
              <span className="pane-tab-icon">{tab.icon}</span>
              <span className="pane-tab-label">{tab.label}</span>
              {tab.dirty ? <span className="pane-tab-dirty">●</span> : null}
              {tab.closable ? (
                <span
                  className="pane-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab?.(tab.id);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pane-tabs-meta">
        <span className="sub-toolbar-dot" />
        <span className="pane-tabs-title">{title}</span>
      </div>
      {rightSlot ? <div className="pane-tabs-actions">{rightSlot}</div> : null}
    </div>
  );
}
