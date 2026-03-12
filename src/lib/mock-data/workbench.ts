export type WorkspaceTask = {
  id: string;
  name: string;
  slug: string;
  path?: string;
  status?: string;
  change: string;
  count: number;
  selected?: boolean;
};

export type TabItem = {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
};

export type TerminalLine = {
  id: string;
  tone?: "default" | "muted" | "accent" | "success";
  content: string;
};

export type ChangedFile = {
  id: string;
  name: string;
  path?: string;
  kind: "folder" | "file";
  status?: string;
  added?: number;
  removed?: number;
};

export type WorkspaceContext = {
  id: string;
  name: string;
  path: string;
  status: string;
};

export const workspaceTasks: WorkspaceTask[] = [
  {
    id: "use-any-agents",
    name: "use any agents",
    slug: "use-any-agents",
    change: "+46",
    count: 733,
    selected: true
  },
  {
    id: "create-parallel-branch",
    name: "create parallel branch...",
    slug: "create-parallel-branch",
    change: "+193",
    count: 815
  },
  {
    id: "see-changes",
    name: "see changes",
    slug: "see-changes",
    change: "+394",
    count: 23
  },
  {
    id: "open-in-any-ide",
    name: "open in any IDE",
    slug: "open-in-any-ide",
    change: "+33",
    count: 816
  },
  {
    id: "forward-ports",
    name: "forward ports",
    slug: "forward-ports",
    change: "+127",
    count: 902
  }
];

export const tabs: TabItem[] = [
  { id: "claude", label: "claude", icon: "✹", active: true },
  { id: "codex", label: "codex", icon: "◌" },
  { id: "gemini", label: "gemini", icon: "✦" },
  { id: "cursor", label: "cursor", icon: "◈" }
];

export const terminalLines: TerminalLine[] = [
  { id: "line-1", tone: "accent", content: "*  mcp" },
  {
    id: "line-2",
    content: "Manage MCP servers"
  },
  {
    id: "line-3",
    tone: "muted",
    content: "1 server"
  },
  {
    id: "line-4",
    content: "1. morph-mcp /"
  },
  {
    id: "line-5",
    tone: "success",
    content: "connected"
  },
  {
    id: "line-6",
    tone: "muted",
    content: "Enter to view details"
  },
  {
    id: "line-7",
    content: "MCP Config locations (by scope):"
  },
  {
    id: "line-8",
    tone: "muted",
    content: "• User config (available in all your projects):"
  },
  {
    id: "line-9",
    tone: "muted",
    content: "  /Users/kletho/.claude.json"
  },
  {
    id: "line-10",
    tone: "muted",
    content: "• Project config (shared via .mcp.json):"
  },
  {
    id: "line-11",
    tone: "muted",
    content: "  /Users/kletho/.superset/worktrees/superset/cloud-ws/.mcp.json"
  },
  {
    id: "line-12",
    tone: "muted",
    content: "• Local config (private to you in this project):"
  },
  {
    id: "line-13",
    tone: "muted",
    content: "  /Users/kletho/.claude.json [project: ...]"
  },
  {
    id: "line-14",
    tone: "muted",
    content: "Tip: Use /mcp enable or /mcp disable to quickly toggle all servers"
  },
  {
    id: "line-15",
    tone: "muted",
    content: "For help configuring MCP servers, see: https://code.claude.com/docs/en/mcp"
  },
  {
    id: "line-16",
    tone: "muted",
    content: "Enter to confirm · Esc to cancel"
  }
];

export const changedFiles: ChangedFile[] = [
  { id: "bun-lock", name: "bun.lock", kind: "file", added: 38, removed: 25 },
  { id: "packages", name: "packages/db/src/schema", kind: "folder" },
  { id: "cloud-workspace", name: "cloud-workspace.ts", kind: "file", added: 119 },
  { id: "enums", name: "enums.ts", kind: "file", added: 21 },
  { id: "renderer", name: "apps/desktop/src/renderer", kind: "folder" },
  { id: "terminal", name: "CloudTerminal.tsx", kind: "file", added: 169 },
  { id: "workspace-sidebar", name: "useCloudWorkspaces.ts", kind: "file", added: 84 },
  { id: "workspace-disabler", name: "WorkspaceDisabler.tsx", kind: "file", added: 14 },
  { id: "routers", name: "apps/api/src/trpc/routers", kind: "folder" },
  { id: "ssh", name: "ssh-manager.ts", kind: "file", added: 277 },
  { id: "index", name: "index.ts", kind: "file", added: 7 }
];

export const ports = [
  { id: "port-3002", label: "use any agents", ports: ["3002"] },
  { id: "port-5678", label: "see changes", ports: ["3000", "3001", "5678"] }
];

export function getWorkspaceContext(task: WorkspaceTask): WorkspaceContext {
  return {
    id: task.id,
    name: task.name,
    path: task.path ?? `~/code/${task.slug}`,
    status: task.status ?? "demo"
  };
}

export function formatWorkspacePath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
