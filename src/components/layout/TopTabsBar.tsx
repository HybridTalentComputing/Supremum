import { tabs } from "../../lib/mock-data/workbench";

type TopTabsBarProps = {
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
};

export function TopTabsBar({ activeTabId, onSelectTab }: TopTabsBarProps) {
  return (
    <header className="top-tabs">
      <div className="brand-strip" data-tauri-drag-region>
        superset
      </div>
      <div className="tabs-row">
        <div className="tabs-list">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                className={`tab-item${active ? " is-active" : ""}`}
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="tab-item-icon">{tab.icon}</span>
                <span className="tab-item-label">{tab.label}</span>
                <span className="tab-item-close">×</span>
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
